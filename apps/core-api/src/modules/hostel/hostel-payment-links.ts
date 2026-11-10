import { createHash, randomBytes } from "node:crypto";
import { postgresService } from "../../database/postgres";
import { HostelError, newId } from "./hostel.common";

const LINK_LIFETIME_DAYS = 14;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const newSecret = (): string => randomBytes(32).toString("base64url");
export const hashSecret = (secret: string): string =>
  createHash("sha256").update(secret).digest("hex");

export const isSecretShaped = (value: string): boolean => TOKEN_PATTERN.test(value);

const publicUrl = (name: string, fallback: string): string => {
  const url = (process.env[name] || fallback).replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production" && !url.startsWith("https://")) {
    throw new HostelError(503, `${name} must be an https address in production.`);
  }
  return url;
};

export const appUrl = (): string => publicUrl("APP_PUBLIC_URL", "http://localhost:3000");
export const apiUrl = (): string => publicUrl("API_PUBLIC_URL", "http://localhost:4000");

// Each link is new, so the raw token only ever exists in the message that carries it.
export const issuePaymentLink = async (institutionId: string, invoiceId: string): Promise<string> => {
  const token = newSecret();
  await postgresService.query(
    `INSERT INTO hostel_payment_links (id, institution_id, invoice_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::interval)`,
    [newId(), institutionId, invoiceId, hashSecret(token), String(LINK_LIFETIME_DAYS)]
  );
  return `${appUrl()}/hostel/payment/${token}`;
};

export const findPaymentLink = async (token: string) => {
  // The message is the same for any bad link, so nothing can be learned by guessing.
  const notFound = new HostelError(404, "This payment link is not valid.");
  if (!isSecretShaped(token)) throw notFound;

  const { rows } = await postgresService.query(
    `SELECT l.institution_id, l.invoice_id, l.expires_at <= NOW() AS is_expired, i.allocation_id
     FROM hostel_payment_links l JOIN hostel_invoices i ON i.id = l.invoice_id
     WHERE l.token_hash = $1`,
    [hashSecret(token)]
  );
  if (!rows[0]) throw notFound;
  return rows[0] as {
    institution_id: string;
    invoice_id: string;
    allocation_id: string;
    is_expired: boolean;
  };
};
