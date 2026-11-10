import { postgresService } from "../../database/postgres";
import { HostelError } from "../hostel/hostel.common";
import { detectMimeType } from "../hostel/hostel-documents.repository";
import { Actor, audit } from "../identity/identity.service";

const fail = (status: number, message: string): never => {
  throw new HostelError(status, message);
};

type FieldType = "text" | "email" | "textarea" | "bool" | "number" | "date" | "color" | "image";
type Section = { fields: Record<string, { type: FieldType; max?: number; min?: number }>; notes: string[] };

const MAX_IMAGE_BYTES = 512 * 1024;

// Every settings page and the fields it may store. Anything else sent is refused.
export const SECTIONS: Record<string, Section> = {
  general: {
    fields: { systemName: { type: "text" }, supportEmail: { type: "email" }, supportPhone: { type: "text", max: 30 }, maintenanceMode: { type: "bool" }, registrationEnabled: { type: "bool" } },
    notes: ["Maintenance mode is enforced: while it is on, only admins can use the system.", "Registration enabled is saved for reference; public sign-up is controlled by the platform."],
  },
  institution: {
    fields: { institutionName: { type: "text" }, shortName: { type: "text", max: 50 }, institutionEmail: { type: "email" }, phone: { type: "text", max: 30 }, address: { type: "textarea" }, website: { type: "text" } },
    notes: [],
  },
  calendar: {
    fields: { academicYear: { type: "text", max: 20 }, startDate: { type: "date" }, endDate: { type: "date" }, semesterCount: { type: "number", min: 1, max: 12 } },
    notes: [],
  },
  timezone: {
    fields: { timezone: { type: "text", max: 60 }, dateFormat: { type: "text", max: 20 }, timeFormat: { type: "text", max: 20 } },
    notes: ["Hostel due dates and meal times use the time zone in Hostel Rent Settings."],
  },
  language: { fields: { defaultLanguage: { type: "text", max: 20 }, allowLanguageSwitch: { type: "bool" } }, notes: [] },
  theme: { fields: { defaultTheme: { type: "text", max: 20 }, allowThemeSwitch: { type: "bool" }, primaryColor: { type: "color" } }, notes: [] },
  branding: { fields: { brandName: { type: "text" }, tagline: { type: "text" }, primaryColor: { type: "color" }, secondaryColor: { type: "color" } }, notes: [] },
  logo: { fields: { logo: { type: "image" }, darkLogo: { type: "image" }, favicon: { type: "image" } }, notes: ["Images must be PNG or JPG, up to 512 KB each."] },
  backup: {
    fields: { autoBackup: { type: "bool" }, frequency: { type: "text", max: 20 }, retentionDays: { type: "number", min: 1, max: 3650 }, includeFiles: { type: "bool" } },
    notes: ["Saved as your backup policy. The application does not run backups itself; schedule database backups (for example pg_dump) on the server."],
  },
};

// Credentials are never stored through settings. Email uses the server's SMTP settings,
// and payment gateways are set up, encrypted, on the API & Integration page.
export const SECRET_SECTIONS: Record<string, string> = {
  smtp: "Email is sent with the server's SMTP settings (EMAIL_USER, EMAIL_PASS and related environment variables). Passwords are not stored here.",
  sms: "SMS gateway keys are not stored here. SMS sending is not configured on this server yet.",
  payment: "Payment gateway credentials are set on Admin → API & Integration → Payment Gateway, where they are stored encrypted.",
};

const clean = (section: Section, input: any) => {
  if (!input || typeof input !== "object") fail(400, "Send the settings to save.");
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const field = section.fields[key];
    if (!field) fail(400, `Unknown setting: ${key}.`);
    if (value === null || value === undefined || value === "") {
      result[key] = field.type === "bool" ? false : null;
      continue;
    }
    switch (field.type) {
      case "bool":
        if (typeof value !== "boolean") fail(400, `${key} must be on or off.`);
        result[key] = value;
        break;
      case "number": {
        const number = Number(value);
        if (!Number.isInteger(number) || number < (field.min ?? 0) || number > (field.max ?? 1_000_000)) fail(400, `${key} must be a whole number from ${field.min ?? 0} to ${field.max}.`);
        result[key] = number;
        break;
      }
      case "date":
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, `${key} must be a date.`);
        result[key] = value;
        break;
      case "color":
        if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) fail(400, `${key} must be a colour like #1d4ed8.`);
        result[key] = value;
        break;
      case "email":
        if (typeof value !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail(400, `${key} must be an email address.`);
        result[key] = (value as string).trim().toLowerCase();
        break;
      case "image": {
        const file = value as any;
        if (typeof file?.contentBase64 !== "string") fail(400, `${key} must be an image file.`);
        const content = Buffer.from(file.contentBase64, "base64");
        if (content.length === 0 || content.length > MAX_IMAGE_BYTES) fail(400, `${key} must be an image of 512 KB or less.`);
        const mimeType = detectMimeType(content);
        if (mimeType !== "image/png" && mimeType !== "image/jpeg") fail(400, `${key} must be a PNG or JPG image.`);
        result[key] = { fileName: String(file.fileName || key).slice(0, 200), mimeType, contentBase64: file.contentBase64 };
        break;
      }
      default: {
        if (typeof value !== "string") fail(400, `${key} must be text.`);
        const max = field.max ?? (field.type === "textarea" ? 1000 : 200);
        if ((value as string).length > max) fail(400, `${key} must be ${max} characters or fewer.`);
        result[key] = (value as string).trim();
      }
    }
  }
  return result;
};

const sectionOf = (name: string) => {
  if (SECRET_SECTIONS[name]) fail(409, SECRET_SECTIONS[name]);
  const section = SECTIONS[name];
  if (!section) fail(404, "Unknown settings page.");
  return section;
};

export const settingsService = {
  async get(tenantId: string, name: string) {
    if (SECRET_SECTIONS[name]) return { section: name, data: {}, notes: [SECRET_SECTIONS[name]], managedElsewhere: true, updatedAt: null };
    const section = sectionOf(name);
    const { rows } = await postgresService.query("SELECT data, updated_by, updated_at FROM erp_settings WHERE tenant_id = $1 AND section = $2", [tenantId, name]);
    return { section: name, data: rows[0]?.data || {}, notes: section.notes, managedElsewhere: false, updatedBy: rows[0]?.updated_by || null, updatedAt: rows[0]?.updated_at || null };
  },

  // Saves only the fields sent; others on the page keep their stored value.
  async save(actor: Actor, name: string, input: any) {
    const section = sectionOf(name);
    const values = clean(section, input);
    await postgresService.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO erp_settings (tenant_id, section, data, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, section) DO UPDATE SET data = erp_settings.data || EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [actor.institutionId, name, JSON.stringify(values), actor.email]
      );
      await audit(tx, actor, "Updated", "Settings", name, `Saved ${name} settings: ${Object.keys(values).join(", ")}.`);
    });
    return this.get(actor.institutionId, name);
  },
};
