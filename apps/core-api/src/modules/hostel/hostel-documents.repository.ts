import { postgresService } from "../../database/postgres";
import { HostelContext, HostelError, newId, toIso, writeAudit } from "./hostel.common";

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_TYPES = ["STUDENT_CARD", "STUDENT_NID", "GUARDIAN_NID"];

// The type comes from the file's own bytes, not from what the browser claims.
export const detectMimeType = (content: Buffer): string | null => {
  if (content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (content.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
};

export const cleanFileName = (name: unknown): string => {
  const base = String(name || "document").split(/[\\/]/).pop() as string;
  return base.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 200) || "document";
};

const metaFromRow = (row: any) => ({
  id: row.id,
  allocationId: row.allocation_id,
  documentType: row.document_type,
  fileName: row.file_name,
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes,
  uploadedBy: row.uploaded_by,
  createdAt: toIso(row.created_at),
});

export const hostelDocumentsRepository = {
  async list(institutionId: string, allocationId: string) {
    const { rows } = await postgresService.query(
      `SELECT id, allocation_id, document_type, file_name, mime_type, size_bytes, uploaded_by, created_at
       FROM hostel_documents WHERE institution_id = $1 AND allocation_id = $2 ORDER BY document_type`,
      [institutionId, allocationId]
    );
    return rows.map(metaFromRow);
  },

  // A new upload of the same type replaces the old file.
  upload(ctx: HostelContext, allocationId: string, body: any) {
    if (!DOCUMENT_TYPES.includes(body?.documentType)) {
      throw new HostelError(400, `Document type must be one of: ${DOCUMENT_TYPES.join(", ")}.`);
    }
    if (typeof body?.contentBase64 !== "string" || !body.contentBase64) {
      throw new HostelError(400, "The file is empty.");
    }

    const content = Buffer.from(body.contentBase64, "base64");
    if (content.length === 0) throw new HostelError(400, "The file is empty.");
    if (content.length > MAX_DOCUMENT_BYTES) {
      throw new HostelError(400, "The file must be 5 MB or smaller.");
    }
    const mimeType = detectMimeType(content);
    if (!mimeType) throw new HostelError(400, "Only JPG, PNG and PDF files are allowed.");

    const fileName = cleanFileName(body.fileName);

    return postgresService.transaction(async (tx) => {
      const allocation = await tx.query(
        "SELECT student_id, student_name FROM hostel_allocations WHERE institution_id = $1 AND id = $2 FOR UPDATE",
        [ctx.institutionId, allocationId]
      );
      if (!allocation.rows[0]) throw new HostelError(404, "Allocation not found.");

      const { rows } = await tx.query(
        `INSERT INTO hostel_documents (id, institution_id, allocation_id, document_type, file_name,
           mime_type, size_bytes, content, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (allocation_id, document_type) DO UPDATE SET
           file_name = EXCLUDED.file_name, mime_type = EXCLUDED.mime_type,
           size_bytes = EXCLUDED.size_bytes, content = EXCLUDED.content,
           uploaded_by = EXCLUDED.uploaded_by, created_at = NOW()
         RETURNING id, allocation_id, document_type, file_name, mime_type, size_bytes, uploaded_by, created_at`,
        [newId(), ctx.institutionId, allocationId, body.documentType, fileName, mimeType, content.length, content, ctx.actorEmail]
      );
      await writeAudit(
        tx,
        ctx,
        "Uploaded",
        "Document",
        rows[0].id,
        `Uploaded ${body.documentType} for ${allocation.rows[0].student_name} (${allocation.rows[0].student_id}).`
      );
      return metaFromRow(rows[0]);
    });
  },

  download(ctx: HostelContext, id: string) {
    return postgresService.transaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT d.*, a.student_id FROM hostel_documents d
         JOIN hostel_allocations a ON a.id = d.allocation_id
         WHERE d.institution_id = $1 AND d.id = $2`,
        [ctx.institutionId, id]
      );
      if (!rows[0]) throw new HostelError(404, "Document not found.");

      await writeAudit(tx, ctx, "Viewed", "Document", id, `Opened ${rows[0].document_type} of student ${rows[0].student_id}.`);
      return {
        ...metaFromRow(rows[0]),
        contentBase64: rows[0].content.toString("base64"),
      };
    });
  },
};
