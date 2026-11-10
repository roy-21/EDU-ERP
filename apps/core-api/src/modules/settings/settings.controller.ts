import { Router } from "express";
import { postgresService } from "../../database/postgres";
import { db } from "../../database/db";
import { requirePermissionKey } from "../../middleware/auth.middleware";
import { HostelError, newId, route, send, toIso } from "../hostel/hostel.common";
import { actorOf } from "../identity/identity.controller";
import { Actor, audit } from "../identity/identity.service";
import { settingsService } from "./settings.service";

const fail = (status: number, message: string): never => {
  throw new HostelError(status, message);
};

export const settingsRouter = Router();

// ---- Settings pages, per institution ----------------------------------------

settingsRouter.get("/settings/:section", route(async (req, res) => {
  const result = await settingsService.get(req.institutionId as string, req.params.section);
  // The old screens read the stored values directly.
  send(res, 200, req.params.section === "general" && req.query.full !== "1" ? result.data : result);
}));

settingsRouter.put("/settings/:section", requirePermissionKey("settings.update"), route(async (req, res) => {
  const result = await settingsService.save(actorOf(req), req.params.section, req.body);
  send(res, 200, result);
}));

// ---- Grading, per institution ------------------------------------------------

const number = (value: unknown, label: string, min: number, max: number, whole = false) => {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max || (whole && !Number.isInteger(result))) fail(400, `${label} must be ${whole ? "a whole number" : "a number"} from ${min} to ${max}.`);
  return result;
};

// Ranges may not overlap, so every mark maps to exactly one grade.
export const parseGrading = (input: any) => {
  const ranges = input?.gradeRanges;
  if (!Array.isArray(ranges) || ranges.length === 0 || ranges.length > 20) fail(400, "Add between 1 and 20 grades.");
  const gradeRanges = ranges.map((item: any, index: number) => {
    const letter = typeof item?.letter === "string" ? item.letter.trim() : "";
    if (!letter || letter.length > 5) fail(400, `Grade ${index + 1} needs a letter of up to 5 characters.`);
    const minMark = number(item.minMark, `${letter} lowest mark`, 0, 100);
    const maxMark = number(item.maxMark, `${letter} highest mark`, 0, 100);
    if (minMark > maxMark) fail(400, `${letter}: the lowest mark is above the highest.`);
    return { id: index + 1, letter, minMark, maxMark, gradePoint: number(item.gradePoint, `${letter} grade point`, 0, 10) };
  });
  const letters = gradeRanges.map((item: any) => item.letter);
  if (new Set(letters).size !== letters.length) fail(400, "Each grade letter can be used once.");
  const sorted = [...gradeRanges].sort((a: any, b: any) => a.minMark - b.minMark);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].minMark <= sorted[i - 1].maxMark) fail(400, `${sorted[i - 1].letter} and ${sorted[i].letter} overlap.`);
  }
  const minSemesterCredit = number(input?.minSemesterCredit, "Minimum semester credit", 0, 60, true);
  const maxSemesterCredit = number(input?.maxSemesterCredit, "Maximum semester credit", 0, 60, true);
  if (minSemesterCredit > maxSemesterCredit) fail(400, "The minimum semester credit is above the maximum.");
  const policy = (value: any, label: string, gradeKey: string) => {
    const grade = value?.[gradeKey];
    if (grade && !letters.includes(grade)) fail(400, `${label}: "${grade}" is not one of your grades.`);
    return { isAllowed: value?.isAllowed === true, [label === "Retake" ? "maxRetakeAllowed" : "maxImprovementAllowed"]: number(value?.[label === "Retake" ? "maxRetakeAllowed" : "maxImprovementAllowed"] ?? 0, `${label} limit`, 0, 10, true), [gradeKey]: grade || letters[letters.length - 1] };
  };
  const text = (value: unknown, label: string) => {
    if (typeof value !== "string" || !value.trim() || value.length > 50) fail(400, `${label} is required.`);
    return (value as string).trim();
  };
  return {
    systemType: text(input?.systemType, "Grading system"),
    gpaScale: String(number(input?.gpaScale, "GPA scale", 1, 10).toFixed(2)),
    passMarks: number(input?.passMarks, "Pass marks", 0, 100),
    cgpaFormula: text(input?.cgpaFormula, "CGPA formula"),
    gradeRanges,
    defaultCourseCredit: number(input?.defaultCourseCredit, "Default course credit", 0, 10),
    minSemesterCredit,
    maxSemesterCredit,
    retakePolicy: policy(input?.retakePolicy, "Retake", "applicableIfGradeBelow"),
    improvementPolicy: policy(input?.improvementPolicy, "Improvement", "applicableIfGradeEqualOrAbove"),
  };
};

const gradingOf = async (tenantId: string) => {
  const { rows } = await postgresService.query("SELECT data FROM erp_settings WHERE tenant_id = $1 AND section = 'grading'", [tenantId]);
  // Until an institution saves its own, it starts from the standard 4.00 scale.
  return rows[0]?.data || db.gradingConfig;
};

settingsRouter.get("/system/grading-config", route(async (req, res) => {
  send(res, 200, await gradingOf(req.institutionId as string));
}));

settingsRouter.put("/system/grading-config", requirePermissionKey("examination.update"), route(async (req, res) => {
  const actor = actorOf(req);
  const config = parseGrading({ ...(await gradingOf(actor.institutionId)), ...req.body });
  await postgresService.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO erp_settings (tenant_id, section, data, updated_by) VALUES ($1, 'grading', $2, $3)
       ON CONFLICT (tenant_id, section) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [actor.institutionId, JSON.stringify(config), actor.email]
    );
    await audit(tx, actor, "Updated", "Settings", "grading", `Saved grading: ${config.gradeRanges.length} grades, pass mark ${config.passMarks}.`);
  });
  res.status(200).json({ success: true, statusCode: 200, data: config, message: "Grading system configuration successfully updated." });
}));

// ---- Table builder designs ---------------------------------------------------

const COLUMN_TYPES = ["String", "Text", "Integer", "Float", "Boolean", "Date", "DateTime", "JSON", "UUID"];
const RELATIONS = ["none", "one-to-one", "one-to-many", "many-to-many"];
const NAME = /^[a-z_][a-z0-9_]{0,62}$/;

const parseTable = async (actor: Actor, body: any) => {
  const tableName = typeof body?.tableName === "string" ? body.tableName.trim() : "";
  if (!tableName || tableName.length > 100) fail(400, "Give the table a name of up to 100 characters.");
  const slug = (typeof body?.slug === "string" && body.slug ? body.slug : tableName).toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (!NAME.test(slug)) fail(400, "The table key must start with a letter or underscore and use only lowercase letters, numbers and underscores.");
  const list = body?.columns;
  if (!Array.isArray(list) || list.length === 0 || list.length > 100) fail(400, "Add between 1 and 100 columns.");
  const existing = (await postgresService.query("SELECT slug FROM erp_tables WHERE institution_id = $1", [actor.institutionId])).rows.map((row: any) => row.slug);
  const columns = list.map((raw: any, index: number) => {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    if (!NAME.test(name)) fail(400, `Column ${index + 1}: use lowercase letters, numbers and underscores, starting with a letter.`);
    if (!COLUMN_TYPES.includes(raw?.type)) fail(400, `Column ${name}: type must be one of ${COLUMN_TYPES.join(", ")}.`);
    const isForeignKey = raw?.isForeignKey === true;
    if (isForeignKey && ![...existing, slug].includes(raw?.fkTable)) fail(400, `Column ${name}: the linked table "${raw?.fkTable || ""}" does not exist.`);
    return {
      name,
      label: typeof raw?.label === "string" ? raw.label.slice(0, 100) : "",
      type: raw.type,
      isPrimaryKey: raw?.isPrimaryKey === true,
      isForeignKey,
      fkTable: isForeignKey ? raw.fkTable : "",
      fkColumn: isForeignKey && typeof raw?.fkColumn === "string" ? raw.fkColumn.slice(0, 63) : "",
      relation: RELATIONS.includes(raw?.relation) ? raw.relation : "none",
      validation: { required: raw?.validation?.required === true },
      isSearchable: raw?.isSearchable === true,
      isSortable: raw?.isSortable === true,
      isFilterable: raw?.isFilterable === true,
      isVisible: raw?.isVisible !== false,
    };
  });
  const names = columns.map((item: any) => item.name);
  if (new Set(names).size !== names.length) fail(400, "Two columns have the same name.");
  if (columns.filter((item: any) => item.isPrimaryKey).length !== 1) fail(400, "Mark exactly one column as the primary key.");
  return { tableName, slug, isExportable: body?.isExportable !== false, columns };
};

const tableFromRow = (row: any) => ({
  id: row.id, tableName: row.table_name, slug: row.slug, isExportable: row.is_exportable, columns: row.columns,
  createdBy: row.created_by, createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
});

settingsRouter.get("/system/tables", requirePermissionKey("system.manage_forms", "system.read"), route(async (req, res) => {
  const { rows } = await postgresService.query("SELECT * FROM erp_tables WHERE institution_id = $1 ORDER BY table_name", [req.institutionId]);
  send(res, 200, rows.map(tableFromRow));
}));

// Saving the same key again replaces that table's design.
settingsRouter.post("/system/tables/schema", requirePermissionKey("system.manage_forms"), route(async (req, res) => {
  const actor = actorOf(req);
  const table = await parseTable(actor, req.body);
  const saved = await postgresService.transaction(async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO erp_tables (id, institution_id, table_name, slug, is_exportable, columns, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (institution_id, slug) DO UPDATE SET table_name = EXCLUDED.table_name, is_exportable = EXCLUDED.is_exportable,
         columns = EXCLUDED.columns, updated_at = NOW()
       RETURNING *`,
      [newId(), actor.institutionId, table.tableName, table.slug, table.isExportable, JSON.stringify(table.columns), actor.email]
    );
    await audit(tx, actor, "Saved", "Table", rows[0].id, `Saved table design ${table.tableName} (${table.slug}) with ${table.columns.length} column(s).`);
    return rows[0];
  });
  res.status(201).json({ success: true, statusCode: 201, data: tableFromRow(saved), message: "Table design saved. To keep records with a form and list, use the Feature Builder." });
}));

settingsRouter.delete("/system/tables/:slug", requirePermissionKey("system.manage_forms"), route(async (req, res) => {
  const actor = actorOf(req);
  const linked = await postgresService.query(
    `SELECT table_name FROM erp_tables WHERE institution_id = $1 AND slug <> $2
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(columns) c WHERE c->>'fkTable' = $2)`,
    [actor.institutionId, req.params.slug]
  );
  if (linked.rows[0]) fail(409, `Other tables link to this one: ${linked.rows.map((row: any) => row.table_name).join(", ")}.`);
  const { rows } = await postgresService.query("DELETE FROM erp_tables WHERE institution_id = $1 AND slug = $2 RETURNING id, table_name", [actor.institutionId, req.params.slug]);
  if (!rows[0]) fail(404, "Table not found.");
  await audit(postgresService, actor, "Deleted", "Table", rows[0].id, `Deleted table design ${rows[0].table_name}.`);
  send(res, 200, { deleted: true });
}));
