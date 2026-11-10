import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { HostelError } from "./hostel.common";

const MIN_KEY_LENGTH = 32;

const encryptionKey = (): Buffer => {
  const secret = process.env.HOSTEL_SECRET_KEY || "";
  if (secret.length < MIN_KEY_LENGTH) {
    throw new HostelError(
      503,
      `Set HOSTEL_SECRET_KEY (at least ${MIN_KEY_LENGTH} characters) in the backend environment before saving payment credentials.`
    );
  }
  return createHash("sha256").update(secret).digest();
};

export const hasEncryptionKey = (): boolean =>
  (process.env.HOSTEL_SECRET_KEY || "").length >= MIN_KEY_LENGTH;

export const encryptSecret = (plain: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64")).join(".");
};

export const decryptSecret = (stored: string): string => {
  const [iv, tag, body] = stored.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
};
