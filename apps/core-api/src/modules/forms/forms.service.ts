import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { HostelError, newId, toIso } from "../hostel/hostel.common";
import { Actor, audit } from "../identity/identity.service";

const fail = (status: number, message: string): never => {
  throw new HostelError(status, message);
};

export const FIELD_TYPES = ["text", "textarea", "email", "phone", "number", "date", "select", "radio", "checkbox", "multiselect"];
const WITH_OPTIONS = ["select", "radio", "multiselect"];
const OPERATORS = ["equals", "notEquals", "in", "notEmpty", "empty"];
const PURPOSES = ["GENERAL", "USER_PROFILE", "FEATURE"];
const MAX_FIELDS = 100;
const FIELD_ID = /^[a-z][a-z0-9_]{0,49}$/;

export type FormField = {
  id: string;
  type: string;
  label: string;
  required: boolean;
  placeholder: string;
  helpText: string;
  options: string[];
  min: number | null;
  max: number | null;
  maxLength: number | null;
  showIf: { field: string; operator: string; value: unknown } | null;
};

const text = (value: unknown, label: string, max: number, required = false): string => {
  if (value !== undefined && value !== null && typeof value !== "string") fail(400, `${label} must be text.`);
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) fail(400, `${label} is required.`);
  if (result.length > max) fail(400, `${label} must be ${max} characters or fewer.`);
  return result;
};

const optionalNumber = (value: unknown, label: string): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) fail(400, `${label} must be a number.`);
  return number;
};

// Checks a form's design. A condition may only look at a field above it, so there are no loops.
export const parseFields = (input: unknown): FormField[] => {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_FIELDS) fail(400, `A form needs between 1 and ${MAX_FIELDS} fields.`);
  const seen = new Map<string, FormField>();
  return (input as any[]).map((raw, index) => {
    const label = text(raw?.label, `Field ${index + 1} label`, 200, true);
    const id = typeof raw?.id === "string" && raw.id ? raw.id : `field_${index + 1}`;
    if (!FIELD_ID.test(id)) fail(400, `Field "${label}" has an invalid id. Use lowercase letters, numbers and underscores.`);
    if (seen.has(id)) fail(400, `Two fields use the id "${id}".`);
    const type = raw?.type;
    if (!FIELD_TYPES.includes(type)) fail(400, `Field "${label}" has an unknown type. Use one of: ${FIELD_TYPES.join(", ")}.`);
    let options: string[] = [];
    if (WITH_OPTIONS.includes(type)) {
      if (!Array.isArray(raw?.options) || raw.options.length === 0 || raw.options.length > 100) fail(400, `Field "${label}" needs 1 to 100 options.`);
      options = raw.options.map((option: unknown, i: number) => text(option, `Option ${i + 1} of "${label}"`, 200, true));
      if (new Set(options).size !== options.length) fail(400, `Field "${label}" has the same option twice.`);
    }
    let showIf: FormField["showIf"] = null;
    if (raw?.showIf && raw.showIf.field) {
      const target = seen.get(raw.showIf.field);
      if (!target) fail(400, `Field "${label}" depends on a field that is not above it.`);
      if (!OPERATORS.includes(raw.showIf.operator)) fail(400, `Field "${label}" has an unknown condition. Use one of: ${OPERATORS.join(", ")}.`);
      if (raw.showIf.operator === "in" && !Array.isArray(raw.showIf.value)) fail(400, `The condition on "${label}" needs a list of values.`);
      showIf = { field: raw.showIf.field, operator: raw.showIf.operator, value: raw.showIf.value ?? null };
    }
    const field: FormField = {
      id,
      type,
      label,
      required: raw?.required === true,
      placeholder: text(raw?.placeholder, `Placeholder of "${label}"`, 200),
      helpText: text(raw?.helpText, `Help text of "${label}"`, 500),
      options,
      min: optionalNumber(raw?.min, `Minimum of "${label}"`),
      max: optionalNumber(raw?.max, `Maximum of "${label}"`),
      maxLength: optionalNumber(raw?.maxLength, `Maximum length of "${label}"`),
      showIf,
    };
    if (field.min !== null && field.max !== null && field.min > field.max) fail(400, `Field "${label}" has a minimum above its maximum.`);
    seen.set(id, field);
    return field;
  });
};

const isEmpty = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

const conditionHolds = (condition: NonNullable<FormField["showIf"]>, values: Record<string, unknown>) => {
  const actual = values[condition.field];
  switch (condition.operator) {
    case "equals": return Array.isArray(actual) ? actual.includes(condition.value) : actual === condition.value;
    case "notEquals": return Array.isArray(actual) ? !actual.includes(condition.value) : actual !== condition.value;
    case "in": return (condition.value as unknown[]).some((item) => (Array.isArray(actual) ? actual.includes(item) : actual === item));
    case "notEmpty": return !isEmpty(actual);
    case "empty": return isEmpty(actual);
    default: return false;
  }
};

// Checks answers against a form version. Hidden fields are dropped, so an answer
// to a question the person never saw cannot slip through.
export const validateAnswers = (fields: FormField[], input: unknown): Record<string, unknown> => {
  const data = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const clean: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.showIf && !conditionHolds(field.showIf, clean)) continue;
    let value = data[field.id];
    if (typeof value === "string") value = value.trim();
    if (isEmpty(value) || (field.type === "checkbox" && value === false && field.required)) {
      if (field.required) fail(400, `"${field.label}" is required.`);
      if (field.type === "checkbox") clean[field.id] = false;
      continue;
    }
    const bad = (why: string): never => fail(400, `"${field.label}" ${why}`);
    switch (field.type) {
      case "text":
      case "textarea": {
        if (typeof value !== "string") bad("must be text.");
        const limit = field.maxLength ?? (field.type === "text" ? 500 : 5000);
        if ((value as string).length > limit) bad(`must be ${limit} characters or fewer.`);
        break;
      }
      case "email":
        if (typeof value !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) bad("must be an email address.");
        break;
      case "phone":
        if (typeof value !== "string" || !/^\+?[0-9 -]{6,20}$/.test(value)) bad("must be a phone number.");
        break;
      case "number": {
        const number = typeof value === "string" ? Number(value) : value;
        if (typeof number !== "number" || !Number.isFinite(number)) bad("must be a number.");
        if (field.min !== null && (number as number) < field.min) bad(`must be at least ${field.min}.`);
        if (field.max !== null && (number as number) > field.max) bad(`must be at most ${field.max}.`);
        value = number;
        break;
      }
      case "date":
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) bad("must be a date.");
        break;
      case "select":
      case "radio":
        if (!field.options.includes(value as string)) bad("must be one of the listed options.");
        break;
      case "multiselect":
        if (!Array.isArray(value) || value.some((item) => !field.options.includes(item))) bad("must be chosen from the listed options.");
        value = [...new Set(value as string[])];
        break;
      case "checkbox":
        if (typeof value !== "boolean") bad("must be ticked or not.");
        break;
    }
    clean[field.id] = value;
  }
  return clean;
};

const slugify = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "form";

const formFromRow = (row: any) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  description: row.description,
  formType: row.form_type,
  purpose: row.purpose,
  status: row.status,
  publishedVersion: row.published_version,
  latestVersion: row.latest_version === undefined ? undefined : Number(row.latest_version),
  hasDraft: row.latest_status === "DRAFT",
  submissions: row.submissions === undefined ? undefined : Number(row.submissions),
  createdBy: row.created_by,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const FORM_SELECT = `
  SELECT f.*,
    (SELECT MAX(version) FROM erp_form_versions v WHERE v.form_id = f.id) AS latest_version,
    (SELECT status FROM erp_form_versions v WHERE v.form_id = f.id ORDER BY version DESC LIMIT 1) AS latest_status,
    (SELECT COUNT(*) FROM erp_form_submissions s WHERE s.form_id = f.id) AS submissions
  FROM erp_forms f`;

const lockForm = async (tx: PoolClient, institutionId: string, id: string) => {
  const { rows } = await tx.query("SELECT * FROM erp_forms WHERE institution_id = $1 AND (id = $2 OR slug = $2) FOR UPDATE", [institutionId, id]);
  if (!rows[0]) fail(404, "Form not found.");
  return rows[0];
};

export const formsService = {
  async list(institutionId: string, purpose?: string) {
    const { rows } = await postgresService.query(
      `${FORM_SELECT} WHERE f.institution_id = $1 AND ($2 = '' OR f.purpose = $2) ORDER BY f.updated_at DESC`,
      [institutionId, purpose || ""]
    );
    return rows.map(formFromRow);
  },

  async get(institutionId: string, idOrSlug: string) {
    const { rows } = await postgresService.query(`${FORM_SELECT} WHERE f.institution_id = $1 AND (f.id = $2 OR f.slug = $2)`, [institutionId, idOrSlug]);
    if (!rows[0]) fail(404, "Form not found.");
    const versions = await postgresService.query(
      "SELECT version, status, fields, created_by, created_at, published_at FROM erp_form_versions WHERE form_id = $1 ORDER BY version DESC",
      [rows[0].id]
    );
    const list = versions.rows.map((row: any) => ({
      version: row.version, status: row.status, fields: row.fields, createdBy: row.created_by,
      createdAt: toIso(row.created_at), publishedAt: toIso(row.published_at),
    }));
    return {
      ...formFromRow(rows[0]),
      fields: list[0]?.fields || [],
      publishedFields: list.find((item: any) => item.version === rows[0].published_version)?.fields || null,
      versions: list.map(({ fields, ...rest }: any) => ({ ...rest, fieldCount: fields.length })),
    };
  },

  async version(institutionId: string, idOrSlug: string, version: number) {
    const form = await this.get(institutionId, idOrSlug);
    const { rows } = await postgresService.query("SELECT * FROM erp_form_versions WHERE form_id = $1 AND version = $2", [form.id, version]);
    if (!rows[0]) fail(404, "Version not found.");
    return { version: rows[0].version, status: rows[0].status, fields: rows[0].fields, createdAt: toIso(rows[0].created_at) };
  },

  async create(actor: Actor, body: any) {
    const title = text(body?.title, "Form title", 200, true);
    const fields = parseFields(body?.fields ?? body?.schema);
    const purpose = body?.purpose || "GENERAL";
    if (!PURPOSES.includes(purpose)) fail(400, `Purpose must be one of: ${PURPOSES.join(", ")}.`);
    const slug = slugify(text(body?.slug, "Slug", 100) || title);
    const id = newId();
    try {
      await postgresService.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO erp_forms (id, institution_id, slug, title, description, form_type, purpose, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, actor.institutionId, slug, title, text(body?.description, "Description", 1000), body?.formType === "temporary" ? "temporary" : "permanent", purpose, actor.email]
        );
        await tx.query("INSERT INTO erp_form_versions (form_id, version, fields, created_by) VALUES ($1, 1, $2, $3)", [id, JSON.stringify(fields), actor.email]);
        await audit(tx, actor, "Created", "Form", id, `Created form ${title} with ${fields.length} field(s).`);
      });
    } catch (err: any) {
      if (err.code === "23505") fail(409, "A form with this slug already exists.");
      throw err;
    }
    if (body?.publish === true) await this.publish(actor, id);
    return this.get(actor.institutionId, id);
  },

  // Editing a published form starts a new draft version. Old answers keep their version.
  async update(actor: Actor, idOrSlug: string, body: any) {
    const fields = body?.fields === undefined && body?.schema === undefined ? null : parseFields(body?.fields ?? body?.schema);
    let id = "";
    await postgresService.transaction(async (tx) => {
      const form = await lockForm(tx, actor.institutionId, idOrSlug);
      id = form.id;
      if (form.status === "ARCHIVED") fail(409, "This form is archived.");
      const title = body?.title === undefined ? form.title : text(body.title, "Form title", 200, true);
      const description = body?.description === undefined ? form.description : text(body.description, "Description", 1000);
      await tx.query("UPDATE erp_forms SET title = $2, description = $3, updated_at = NOW() WHERE id = $1", [form.id, title, description]);
      if (fields) {
        const latest = await tx.query("SELECT version, status FROM erp_form_versions WHERE form_id = $1 ORDER BY version DESC LIMIT 1", [form.id]);
        if (latest.rows[0].status === "DRAFT") {
          await tx.query("UPDATE erp_form_versions SET fields = $3, created_by = $4, created_at = NOW() WHERE form_id = $1 AND version = $2", [form.id, latest.rows[0].version, JSON.stringify(fields), actor.email]);
        } else {
          await tx.query("INSERT INTO erp_form_versions (form_id, version, fields, created_by) VALUES ($1, $2, $3, $4)", [form.id, latest.rows[0].version + 1, JSON.stringify(fields), actor.email]);
        }
      }
      await audit(tx, actor, "Updated", "Form", form.id, `Updated form ${title}${fields ? ` (${fields.length} fields, draft)` : ""}.`);
    });
    if (body?.publish === true) await this.publish(actor, id);
    return this.get(actor.institutionId, id);
  },

  async publish(actor: Actor, idOrSlug: string) {
    await postgresService.transaction(async (tx) => {
      const form = await lockForm(tx, actor.institutionId, idOrSlug);
      if (form.status === "ARCHIVED") fail(409, "This form is archived.");
      const latest = await tx.query("SELECT version, status FROM erp_form_versions WHERE form_id = $1 ORDER BY version DESC LIMIT 1", [form.id]);
      if (latest.rows[0].status !== "DRAFT") fail(409, "There is no draft to publish.");
      const version = latest.rows[0].version;
      await tx.query("UPDATE erp_form_versions SET status = 'RETIRED' WHERE form_id = $1 AND status = 'PUBLISHED'", [form.id]);
      await tx.query("UPDATE erp_form_versions SET status = 'PUBLISHED', published_at = NOW() WHERE form_id = $1 AND version = $2", [form.id, version]);
      await tx.query("UPDATE erp_forms SET status = 'PUBLISHED', published_version = $2, updated_at = NOW() WHERE id = $1", [form.id, version]);
      await audit(tx, actor, "Published", "Form", form.id, `Published version ${version} of form ${form.title}.`);
    });
    return this.get(actor.institutionId, idOrSlug);
  },

  async archive(actor: Actor, idOrSlug: string) {
    await postgresService.transaction(async (tx) => {
      const form = await lockForm(tx, actor.institutionId, idOrSlug);
      const used = await tx.query(
        `SELECT (SELECT COUNT(*) FROM erp_roles WHERE form_id = $1)::int + (SELECT COUNT(*) FROM erp_role_forms WHERE form_id = $1)::int
           + (SELECT COUNT(*) FROM erp_features WHERE form_id = $1 AND status <> 'ARCHIVED')::int AS uses`,
        [form.id]
      );
      if (used.rows[0].uses > 0) fail(409, "A role or feature uses this form. Detach it first.");
      await tx.query("UPDATE erp_forms SET status = 'ARCHIVED', updated_at = NOW() WHERE id = $1", [form.id]);
      await audit(tx, actor, "Archived", "Form", form.id, `Archived form ${form.title}.`);
    });
    return this.get(actor.institutionId, idOrSlug);
  },

  async publishedFields(institutionId: string, idOrSlug: string) {
    const { rows } = await postgresService.query(
      `SELECT f.id, f.title, f.status, f.published_version, v.fields FROM erp_forms f
       LEFT JOIN erp_form_versions v ON v.form_id = f.id AND v.version = f.published_version
       WHERE f.institution_id = $1 AND (f.id = $2 OR f.slug = $2)`,
      [institutionId, idOrSlug]
    );
    if (!rows[0]) fail(404, "Form not found.");
    if (rows[0].status !== "PUBLISHED" || !rows[0].fields) fail(409, `The form "${rows[0].title}" is not published.`);
    return { formId: rows[0].id as string, version: rows[0].published_version as number, fields: rows[0].fields as FormField[] };
  },

  async validateAgainstPublished(institutionId: string, idOrSlug: string, answers: unknown) {
    const { fields } = await this.publishedFields(institutionId, idOrSlug);
    return validateAnswers(fields, answers);
  },

  async submit(actor: Actor, idOrSlug: string, answers: unknown) {
    const { formId, version, fields } = await this.publishedFields(actor.institutionId, idOrSlug);
    const data = validateAnswers(fields, answers);
    const id = newId();
    await postgresService.query(
      "INSERT INTO erp_form_submissions (id, institution_id, form_id, version, data, submitted_by) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, actor.institutionId, formId, version, JSON.stringify(data), actor.email || actor.userId]
    );
    return { id, formId, version, data };
  },

  async submissions(institutionId: string, idOrSlug: string) {
    const form = await this.get(institutionId, idOrSlug);
    const { rows } = await postgresService.query(
      // Answers a user account was registered with belong to that account; only user managers see them, on the user.
      "SELECT * FROM erp_form_submissions WHERE institution_id = $1 AND form_id = $2 AND user_id IS NULL ORDER BY created_at DESC LIMIT 500",
      [institutionId, form.id]
    );
    return rows.map((row: any) => ({ id: row.id, version: row.version, data: row.data, submittedBy: row.submitted_by, createdAt: toIso(row.created_at) }));
  },
};
