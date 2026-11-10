import { postgresService } from "../../database/postgres";
import { HostelError, newId, toIso } from "../hostel/hostel.common";
import { MODULE_IDS, MODULES } from "../identity/identity.catalog";
import { Actor, audit } from "../identity/identity.service";
import { formsService, validateAnswers } from "../forms/forms.service";

const fail = (status: number, message: string): never => {
  throw new HostelError(status, message);
};

const text = (value: unknown, label: string, max: number, required = false): string => {
  if (value !== undefined && value !== null && typeof value !== "string") fail(400, `${label} must be text.`);
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) fail(400, `${label} is required.`);
  if (result.length > max) fail(400, `${label} must be ${max} characters or fewer.`);
  return result;
};

const KEY = /^[a-z][a-z0-9_]{1,59}$/;
export const ACTIONS = ["read", "create", "update", "delete"] as const;
export const featurePermission = (moduleId: string, key: string, action: string) => `${moduleId}.feature.${key}.${action}`;

type Feature = {
  id: string; moduleId: string; moduleName: string; key: string; name: string; description: string; icon: string;
  formId: string; formTitle: string; formVersion: number | null; listColumns: string[]; status: string; records: number;
  permissions: string[]; createdBy: string; createdAt: string | null;
};

const featureFromRow = (row: any): Feature => ({
  id: row.id,
  moduleId: row.module_id,
  moduleName: MODULES.find((item) => item.id === row.module_id)?.name || row.module_id,
  key: row.key,
  name: row.name,
  description: row.description,
  icon: row.icon,
  formId: row.form_id,
  formTitle: row.form_title,
  formVersion: row.published_version,
  listColumns: row.list_columns,
  status: row.status,
  records: Number(row.records ?? 0),
  permissions: ACTIONS.map((action) => featurePermission(row.module_id, row.key, action)),
  createdBy: row.created_by,
  createdAt: toIso(row.created_at),
});

const FEATURE_SELECT = `
  SELECT ft.*, f.title AS form_title, f.published_version,
    (SELECT COUNT(*) FROM erp_feature_records r WHERE r.feature_id = ft.id) AS records
  FROM erp_features ft JOIN erp_forms f ON f.id = ft.form_id`;

const loadFeature = async (institutionId: string, moduleId: string, key: string) => {
  const { rows } = await postgresService.query(`${FEATURE_SELECT} WHERE ft.institution_id = $1 AND ft.module_id = $2 AND ft.key = $3`, [institutionId, moduleId, key]);
  if (!rows[0]) fail(404, "Feature not found.");
  return featureFromRow(rows[0]);
};

const parseColumns = (columns: unknown, fieldIds: string[]) => {
  if (columns === undefined) return fieldIds.slice(0, 5);
  if (!Array.isArray(columns) || columns.some((item) => !fieldIds.includes(item))) fail(400, "List columns must be fields of the form.");
  return [...new Set(columns as string[])].slice(0, 10);
};

export const featuresService = {
  async list(institutionId: string): Promise<Feature[]> {
    const { rows } = await postgresService.query(`${FEATURE_SELECT} WHERE ft.institution_id = $1 ORDER BY ft.module_id, ft.name`, [institutionId]);
    return rows.map(featureFromRow);
  },

  // The published features this person may open, for the navigation.
  async available(institutionId: string, permissions: string[]) {
    const held = new Set(permissions);
    return (await this.list(institutionId))
      .filter((item) => item.status === "PUBLISHED" && held.has(featurePermission(item.moduleId, item.key, "read")))
      .map((item) => ({
        ...item,
        can: Object.fromEntries(ACTIONS.map((action) => [action, held.has(featurePermission(item.moduleId, item.key, action))])),
      }));
  },

  // A feature brings its own form. Fields given here become that form's first version.
  async create(actor: Actor, body: any) {
    const moduleId = text(body?.moduleId, "Module", 50, true);
    if (!MODULE_IDS.includes(moduleId)) fail(400, "Choose a module.");
    const key = text(body?.key, "Feature key", 60, true).toLowerCase();
    if (!KEY.test(key)) fail(400, "A feature key has 2 to 60 lowercase letters, numbers or underscores, starting with a letter.");
    const name = text(body?.name, "Feature name", 150, true);
    const exists = await postgresService.query("SELECT 1 FROM erp_features WHERE institution_id = $1 AND module_id = $2 AND key = $3", [actor.institutionId, moduleId, key]);
    if (exists.rows[0]) fail(409, "This module already has a feature with this key.");

    const form = body?.formId
      ? await formsService.get(actor.institutionId, body.formId)
      : await formsService.create(actor, { title: `${name} form`, slug: `feature-${moduleId}-${key}`, purpose: "FEATURE", fields: body?.fields });
    const listColumns = parseColumns(body?.listColumns, form.fields.map((field: any) => field.id));
    const id = newId();
    await postgresService.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO erp_features (id, institution_id, module_id, key, name, description, icon, form_id, list_columns, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, actor.institutionId, moduleId, key, name, text(body?.description, "Description", 1000), text(body?.icon, "Icon", 16), form.id, listColumns, actor.email]
      );
      await audit(tx, actor, "Created", "Feature", id, `Created feature ${name} (${moduleId}.${key}) as a draft.`);
    });
    return loadFeature(actor.institutionId, moduleId, key);
  },

  async update(actor: Actor, id: string, body: any) {
    const { rows } = await postgresService.query("SELECT * FROM erp_features WHERE institution_id = $1 AND id = $2", [actor.institutionId, id]);
    const current = rows[0];
    if (!current) fail(404, "Feature not found.");
    if (current.status === "ARCHIVED") fail(409, "This feature is archived.");
    if (body?.fields !== undefined) await formsService.update(actor, current.form_id, { fields: body.fields });
    const form = await formsService.get(actor.institutionId, current.form_id);
    const listColumns = body?.listColumns === undefined ? current.list_columns.filter((item: string) => form.fields.some((field: any) => field.id === item))
      : parseColumns(body.listColumns, form.fields.map((field: any) => field.id));
    await postgresService.transaction(async (tx) => {
      await tx.query(
        "UPDATE erp_features SET name = $3, description = $4, icon = $5, list_columns = $6, updated_at = NOW() WHERE institution_id = $1 AND id = $2",
        [actor.institutionId, id, body?.name === undefined ? current.name : text(body.name, "Feature name", 150, true),
          body?.description === undefined ? current.description : text(body.description, "Description", 1000),
          body?.icon === undefined ? current.icon : text(body.icon, "Icon", 16), listColumns]
      );
      await audit(tx, actor, "Updated", "Feature", id, `Updated feature ${current.name}${body?.fields !== undefined ? " and its form draft" : ""}.`);
    });
    return loadFeature(actor.institutionId, current.module_id, current.key);
  },

  // Publishing makes the form's draft live too, so records always match a published version.
  async publish(actor: Actor, id: string) {
    const { rows } = await postgresService.query("SELECT * FROM erp_features WHERE institution_id = $1 AND id = $2", [actor.institutionId, id]);
    if (!rows[0]) fail(404, "Feature not found.");
    if (rows[0].status === "ARCHIVED") fail(409, "This feature is archived.");
    const form = await formsService.get(actor.institutionId, rows[0].form_id);
    if (form.hasDraft) await formsService.publish(actor, rows[0].form_id);
    await postgresService.transaction(async (tx) => {
      await tx.query("UPDATE erp_features SET status = 'PUBLISHED', updated_at = NOW() WHERE id = $1", [id]);
      await audit(tx, actor, "Published", "Feature", id, `Published feature ${rows[0].name}. Its permissions can now be given to roles.`);
    });
    return loadFeature(actor.institutionId, rows[0].module_id, rows[0].key);
  },

  async archive(actor: Actor, id: string) {
    const { rows } = await postgresService.query("SELECT * FROM erp_features WHERE institution_id = $1 AND id = $2", [actor.institutionId, id]);
    if (!rows[0]) fail(404, "Feature not found.");
    await postgresService.transaction(async (tx) => {
      await tx.query("UPDATE erp_features SET status = 'ARCHIVED', updated_at = NOW() WHERE id = $1", [id]);
      await audit(tx, actor, "Archived", "Feature", id, `Archived feature ${rows[0].name}. Its records are kept.`);
    });
    return loadFeature(actor.institutionId, rows[0].module_id, rows[0].key);
  },

  // ---- Records, each action guarded by the feature's own permission -------

  async open(institutionId: string, moduleId: string, key: string) {
    const feature = await loadFeature(institutionId, moduleId, key);
    if (feature.status !== "PUBLISHED") fail(404, "Feature not found.");
    const published = await formsService.publishedFields(institutionId, feature.formId);
    return { feature, ...published };
  },

  async records(institutionId: string, moduleId: string, key: string, search = "") {
    const { feature, fields, version } = await this.open(institutionId, moduleId, key);
    const { rows } = await postgresService.query(
      `SELECT * FROM erp_feature_records WHERE institution_id = $1 AND feature_id = $2
         AND ($3 = '' OR data::text ILIKE '%' || $3 || '%')
       ORDER BY created_at DESC LIMIT 500`,
      [institutionId, feature.id, search.trim()]
    );
    return {
      feature,
      fields,
      formVersion: version,
      records: rows.map((row: any) => ({
        id: row.id, data: row.data, formVersion: row.form_version, createdBy: row.created_by, updatedBy: row.updated_by,
        createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
      })),
    };
  },

  async createRecord(actor: Actor, moduleId: string, key: string, data: unknown) {
    const { feature, fields, version } = await this.open(actor.institutionId, moduleId, key);
    const clean = validateAnswers(fields, data);
    const id = newId();
    await postgresService.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO erp_feature_records (id, institution_id, feature_id, form_version, data, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [id, actor.institutionId, feature.id, version, JSON.stringify(clean), actor.email]
      );
      await audit(tx, actor, "Created", feature.name, id, `Added a ${feature.name} record.`);
    });
    return { id, data: clean, formVersion: version };
  },

  async updateRecord(actor: Actor, moduleId: string, key: string, recordId: string, data: unknown) {
    const { feature, fields, version } = await this.open(actor.institutionId, moduleId, key);
    const clean = validateAnswers(fields, data);
    const { rowCount } = await postgresService.query(
      `UPDATE erp_feature_records SET data = $4, form_version = $5, updated_by = $6, updated_at = NOW()
       WHERE institution_id = $1 AND feature_id = $2 AND id = $3`,
      [actor.institutionId, feature.id, recordId, JSON.stringify(clean), version, actor.email]
    );
    if (!rowCount) fail(404, "Record not found.");
    await audit(postgresService, actor, "Updated", feature.name, recordId, `Edited a ${feature.name} record.`);
    return { id: recordId, data: clean, formVersion: version };
  },

  async deleteRecord(actor: Actor, moduleId: string, key: string, recordId: string) {
    const { feature } = await this.open(actor.institutionId, moduleId, key);
    const { rows } = await postgresService.query(
      "DELETE FROM erp_feature_records WHERE institution_id = $1 AND feature_id = $2 AND id = $3 RETURNING data",
      [actor.institutionId, feature.id, recordId]
    );
    if (!rows[0]) fail(404, "Record not found.");
    await audit(postgresService, actor, "Deleted", feature.name, recordId, `Deleted a ${feature.name} record: ${JSON.stringify(rows[0].data).slice(0, 500)}`);
    return { id: recordId, deleted: true };
  },
};
