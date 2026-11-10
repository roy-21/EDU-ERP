import { randomBytes } from "node:crypto";
import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { cleanFileName, detectMimeType } from "./hostel-documents.repository";
import { queueDirect } from "./hostel-notifications.service";
import { getToday } from "./hostel-rent.repository";
import { HostelContext, HostelError, newId, toHostelError, toIso, writeAudit } from "./hostel.common";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DOCUMENT_TYPES = ["PHOTO", "NID", "OTHER"];
const PHONE = /^\+?[0-9][0-9 -]{5,18}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NID = /^[0-9]{10,17}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// Letters and digits that cannot be confused when read aloud at a gate.
const TICKET_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const invalid = (message: string): never => {
  throw new HostelError(400, message);
};

const text = (value: unknown, label: string, max: number, required = false): string => {
  if (value !== undefined && value !== null && typeof value !== "string") invalid(`${label} must be text.`);
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) invalid(`${label} is required.`);
  if (result.length > max) invalid(`${label} must be ${max} characters or fewer.`);
  return result;
};

const newTicket = () =>
  `VT-${Array.from(randomBytes(8), (byte) => TICKET_ALPHABET[byte % TICKET_ALPHABET.length]).join("")}`;

const parseFile = (file: any, type: string) => {
  if (!file) return null;
  const content = Buffer.from(String(file.contentBase64 || ""), "base64");
  if (content.length === 0) invalid(`The ${type.toLowerCase()} file is empty.`);
  if (content.length > MAX_FILE_BYTES) invalid(`The ${type.toLowerCase()} file must be 5 MB or smaller.`);
  const mimeType = detectMimeType(content);
  if (!mimeType) invalid("Only JPG, PNG and PDF files are allowed.");
  if (type === "PHOTO" && mimeType === "application/pdf") invalid("The visitor photo must be a JPG or PNG image.");
  return { type, content, mimeType: mimeType as string, fileName: cleanFileName(file.fileName) };
};

export const parseVisitor = (body: any) => {
  const visitDate = text(body?.visitDate, "Visit date", 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) invalid("Visit date must be a date.");
  const arrival = text(body?.expectedArrival, "Expected arrival", 5, true);
  const departure = text(body?.expectedDeparture, "Expected departure", 5, true);
  if (!TIME.test(arrival) || !TIME.test(departure)) invalid("Times must look like 14:30.");
  if (departure <= arrival) invalid("Departure must be after arrival.");

  const phone = text(body?.visitorPhone, "Visitor phone", 20, true);
  if (!PHONE.test(phone)) invalid("Visitor phone is not a valid phone number.");
  const email = text(body?.visitorEmail, "Visitor email", 255);
  if (email && !EMAIL.test(email)) invalid("Visitor email is not a valid email address.");
  const nid = text(body?.visitorNid, "Visitor NID", 17);
  if (nid && !NID.test(nid)) invalid("Visitor NID must be 10 to 17 digits.");

  const documents = body?.documents || {};
  return {
    allocationId: text(body?.allocationId, "Host student", 64, true),
    visitorName: text(body?.visitorName, "Visitor name", 100, true),
    visitorPhone: phone,
    visitorEmail: email,
    visitorNid: nid,
    relationship: text(body?.relationship, "Relationship", 100, true),
    purpose: text(body?.purpose, "Visit purpose", 500),
    visitDate,
    expectedArrival: arrival,
    expectedDeparture: departure,
    sendTicketTo: ["visitor", "host", "both", "none"].includes(body?.sendTicketTo) ? body.sendTicketTo : "none",
    files: DOCUMENT_TYPES.map((type) => parseFile(documents[type], type)).filter(Boolean) as NonNullable<ReturnType<typeof parseFile>>[],
  };
};

const maskNid = (nid: string) => (nid ? `•••••••${nid.slice(-3)}` : "");

// Pending or approved visits from an earlier day show as Expired and cannot be used.
const statusOf = (row: any, today: string) =>
  ["Pending", "Approved"].includes(row.status) && row.visit_date < today ? "Expired" : row.status;

const visitorFromRow = (row: any, today: string, revealNid = false) => ({
  id: row.id,
  ticketNumber: row.ticket_number,
  allocationId: row.allocation_id,
  hostStudentId: row.host_student_id,
  hostName: row.host_name,
  hostLocation: row.host_location,
  visitorName: row.visitor_name,
  visitorPhone: row.visitor_phone,
  visitorEmail: row.visitor_email,
  visitorNid: revealNid ? row.visitor_nid : maskNid(row.visitor_nid),
  relationship: row.relationship,
  purpose: row.purpose,
  visitDate: row.visit_date,
  expectedArrival: String(row.expected_arrival).slice(0, 5),
  expectedDeparture: String(row.expected_departure).slice(0, 5),
  status: statusOf(row, today),
  statusReason: row.status_reason,
  checkedInAt: toIso(row.checked_in_at),
  checkedInBy: row.checked_in_by,
  checkedOutAt: toIso(row.checked_out_at),
  checkedOutBy: row.checked_out_by,
  hasPhoto: Boolean(row.photo_id),
  photoId: row.photo_id || null,
  createdBy: row.created_by,
  createdAt: toIso(row.created_at),
});

const VISITOR_SELECT = `
  SELECT v.*, (SELECT d.id FROM hostel_visitor_documents d WHERE d.visitor_id = v.id AND d.document_type = 'PHOTO') AS photo_id
  FROM hostel_visitors v`;

const inTransaction = <T>(work: (tx: PoolClient) => Promise<T>) =>
  postgresService.transaction(work).catch((err) => {
    throw toHostelError(err);
  });

const lockVisit = async (tx: PoolClient, institutionId: string, id: string) => {
  const { rows } = await tx.query("SELECT * FROM hostel_visitors WHERE institution_id = $1 AND id = $2 FOR UPDATE", [institutionId, id]);
  if (!rows[0]) throw new HostelError(404, "Visit not found.");
  return rows[0];
};

export const hostelVisitorsService = {
  async list(institutionId: string, revealNid: boolean) {
    const today = await getToday(institutionId);
    const { rows } = await postgresService.query(
      `${VISITOR_SELECT} WHERE v.institution_id = $1 ORDER BY v.visit_date DESC, v.expected_arrival DESC`,
      [institutionId]
    );
    return rows.map((row: any) => visitorFromRow(row, today, revealNid));
  },

  async get(institutionId: string, id: string, revealNid: boolean) {
    const today = await getToday(institutionId);
    const { rows } = await postgresService.query(`${VISITOR_SELECT} WHERE v.institution_id = $1 AND v.id = $2`, [institutionId, id]);
    if (!rows[0]) throw new HostelError(404, "Visit not found.");
    const documents = await postgresService.query(
      "SELECT id, document_type, file_name, mime_type, size_bytes, created_at FROM hostel_visitor_documents WHERE visitor_id = $1 ORDER BY document_type",
      [id]
    );
    const history = await postgresService.query(
      "SELECT action, actor_email, summary, created_at FROM hostel_audit_log WHERE institution_id = $1 AND entity_id = $2 ORDER BY created_at",
      [institutionId, id]
    );
    return {
      ...visitorFromRow(rows[0], today, revealNid),
      documents: documents.rows.map((row: any) => ({
        id: row.id,
        documentType: row.document_type,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        createdAt: toIso(row.created_at),
      })),
      history: history.rows.map((row: any) => ({
        action: row.action,
        actorEmail: row.actor_email,
        summary: row.summary,
        createdAt: toIso(row.created_at),
      })),
    };
  },

  async findByTicket(institutionId: string, ticket: string, revealNid: boolean) {
    const { rows } = await postgresService.query(
      "SELECT id FROM hostel_visitors WHERE institution_id = $1 AND ticket_number = $2",
      [institutionId, ticket.trim().toUpperCase()]
    );
    if (!rows[0]) throw new HostelError(404, "No visit has this ticket number.");
    return this.get(institutionId, rows[0].id, revealNid);
  },

  async create(ctx: HostelContext, body: any) {
    const input = parseVisitor(body);
    const today = await getToday(ctx.institutionId);
    if (input.visitDate < today) invalid("The visit date cannot be in the past.");

    const created = await inTransaction(async (tx) => {
      const { rows } = await tx.query(
        "SELECT * FROM hostel_allocations WHERE institution_id = $1 AND id = $2",
        [ctx.institutionId, input.allocationId]
      );
      const host = rows[0];
      if (!host) throw new HostelError(404, "Host student not found.");
      if (host.status !== "Allocated") throw new HostelError(409, "Visitors can only be registered for a student who has a seat.");

      const id = newId();
      const ticket = newTicket();
      await tx.query(
        `INSERT INTO hostel_visitors (id, institution_id, ticket_number, allocation_id, host_student_id, host_name,
           host_location, visitor_name, visitor_phone, visitor_email, visitor_nid, relationship, purpose, visit_date,
           expected_arrival, expected_departure, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [id, ctx.institutionId, ticket, host.id, host.student_id, host.student_name,
          `${host.room_label || ""}, seat ${host.seat_number ?? "-"}`, input.visitorName, input.visitorPhone,
          input.visitorEmail, input.visitorNid, input.relationship, input.purpose, input.visitDate,
          input.expectedArrival, input.expectedDeparture, ctx.actorEmail]
      );
      for (const file of input.files) {
        await tx.query(
          `INSERT INTO hostel_visitor_documents (id, institution_id, visitor_id, document_type, file_name, mime_type,
             size_bytes, content, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [newId(), ctx.institutionId, id, file.type, file.fileName, file.mimeType, file.content.length, file.content, ctx.actorEmail]
        );
      }
      await writeAudit(tx, ctx, "Registered", "Visitor", id,
        `Registered visit ${ticket}: ${input.visitorName} to see ${host.student_name} (${host.student_id}) on ${input.visitDate}.`);
      return { id, ticket, host };
    });

    if (input.sendTicketTo !== "none") {
      const recipients: [string, string][] = [];
      if (["visitor", "both"].includes(input.sendTicketTo)) recipients.push(["EMAIL", input.visitorEmail]);
      if (["host", "both"].includes(input.sendTicketTo)) recipients.push(["EMAIL", created.host.student_email]);
      // Each address gets its own key, so the visitor and host copies are both sent.
      for (const [index, recipient] of recipients.entries()) {
        await queueDirect(ctx.institutionId, {
          scenario: "VISITOR_TICKET",
          allocationId: created.host.id,
          studentId: created.host.student_id,
          studentName: created.host.student_name,
          recipients: [recipient],
          values: { ticketNumber: created.ticket, visitDate: input.visitDate, studentName: created.host.student_name },
          details: [
            ["Ticket Number", created.ticket],
            ["Visitor", input.visitorName],
            ["Visiting", `${created.host.student_name} (${created.host.student_id})`],
            ["Visit Date", input.visitDate],
            ["Expected Time", `${input.expectedArrival} to ${input.expectedDeparture}`],
          ],
          dedupeKey: `visitor:${created.id}:${index}`,
          triggeredBy: ctx.actorEmail,
        }).catch((err) => console.error("[Hostel] Visitor ticket email failed:", err.message));
      }
    }
    return this.get(ctx.institutionId, created.id, false);
  },

  // Entry is allowed only on the visit day, once, for a pending or approved ticket.
  async checkIn(ctx: HostelContext, id: string) {
    const today = await getToday(ctx.institutionId);
    await inTransaction(async (tx) => {
      const visit = await lockVisit(tx, ctx.institutionId, id);
      const status = statusOf(visit, today);
      if (status === "Checked In") throw new HostelError(409, "This visitor is already checked in.");
      if (!["Pending", "Approved"].includes(status)) throw new HostelError(409, `This ticket is ${status.toLowerCase()} and cannot be used.`);
      if (visit.visit_date !== today) throw new HostelError(409, `This ticket is for ${visit.visit_date}, not today.`);
      await tx.query(
        "UPDATE hostel_visitors SET status = 'Checked In', checked_in_at = NOW(), checked_in_by = $2, updated_at = NOW() WHERE id = $1",
        [id, ctx.actorEmail]
      );
      await writeAudit(tx, ctx, "Checked In", "Visitor", id, `${visit.visitor_name} entered on ticket ${visit.ticket_number}.`);
    });
    return this.get(ctx.institutionId, id, false);
  },

  async checkOut(ctx: HostelContext, id: string) {
    await inTransaction(async (tx) => {
      const visit = await lockVisit(tx, ctx.institutionId, id);
      if (visit.status !== "Checked In") throw new HostelError(409, "Only a visitor who is checked in can be checked out.");
      await tx.query(
        "UPDATE hostel_visitors SET status = 'Checked Out', checked_out_at = NOW(), checked_out_by = $2, updated_at = NOW() WHERE id = $1",
        [id, ctx.actorEmail]
      );
      await writeAudit(tx, ctx, "Checked Out", "Visitor", id, `${visit.visitor_name} left on ticket ${visit.ticket_number}.`);
    });
    return this.get(ctx.institutionId, id, false);
  },

  async setStatus(ctx: HostelContext, id: string, status: "Approved" | "Rejected" | "Cancelled", reason: string) {
    const today = await getToday(ctx.institutionId);
    await inTransaction(async (tx) => {
      const visit = await lockVisit(tx, ctx.institutionId, id);
      const current = statusOf(visit, today);
      const allowed = status === "Approved" ? ["Pending"] : ["Pending", "Approved"];
      if (!allowed.includes(current)) throw new HostelError(409, `A ${current.toLowerCase()} visit cannot be ${status.toLowerCase()}.`);
      if (status !== "Approved" && !reason) throw new HostelError(400, "A reason is required.");
      await tx.query("UPDATE hostel_visitors SET status = $2, status_reason = $3, updated_at = NOW() WHERE id = $1", [id, status, reason]);
      await writeAudit(tx, ctx, status, "Visitor", id, `Visit ${visit.ticket_number} ${status.toLowerCase()}.${reason ? ` Reason: ${reason}` : ""}`);
    });
    return this.get(ctx.institutionId, id, false);
  },

  async document(ctx: HostelContext, documentId: string) {
    return postgresService.transaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT d.*, v.ticket_number FROM hostel_visitor_documents d JOIN hostel_visitors v ON v.id = d.visitor_id
         WHERE d.institution_id = $1 AND d.id = $2`,
        [ctx.institutionId, documentId]
      );
      if (!rows[0]) throw new HostelError(404, "Document not found.");
      await writeAudit(tx, ctx, "Viewed", "Document", documentId, `Opened the ${rows[0].document_type} of visit ${rows[0].ticket_number}.`);
      return {
        id: rows[0].id,
        documentType: rows[0].document_type,
        fileName: rows[0].file_name,
        mimeType: rows[0].mime_type,
        sizeBytes: rows[0].size_bytes,
        createdAt: toIso(rows[0].created_at),
        contentBase64: rows[0].content.toString("base64"),
      };
    });
  },
};
