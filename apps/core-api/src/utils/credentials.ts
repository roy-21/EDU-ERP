/**
 * Credential Utility — Auto-generate usernames & passwords for all roles.
 * Every role (system or dynamic) gets a unique username + hashed password.
 * Credentials are dispatched via SMS & Email; never exposed in plain text in API responses.
 */

import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/** Role-specific username prefix mapping */
const ROLE_PREFIX_MAP: Record<string, string> = {
  SUPER_ADMIN: "sadmin",
  ADMIN: "admin",
  TEACHER: "tchr",
  STUDENT: "std",
  GUARDIAN: "grd",
  HR: "hr",
  ACCOUNTANT: "acct",
  LIBRARIAN: "lib",
  TRANSPORT_MANAGER: "trns",
  HOSTEL_WARDEN: "hstl",
  STOREKEEPER: "store",
  EXAMINER: "exam",
  COUNSELOR: "cnsl",
  RECEPTIONIST: "rcpt",
  IT_ADMIN: "itadm",
  PRINCIPAL: "prin",
  VICE_PRINCIPAL: "vp",
  DEPARTMENT_HEAD: "dhead",
};

/**
 * Generates a URL-safe username from full name + role + timestamp.
 * Pattern: <role_prefix>.<firstname><lastname_initial>.<4-digit-ts>
 * e.g. tchr.johnd.4812
 */
export function generateUsername(fullName: string, role: string): string {
  const prefix = ROLE_PREFIX_MAP[role.toUpperCase()] || role.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6);
  const nameParts = fullName
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim()
    .split(/\s+/);
  const firstName = nameParts[0] || "user";
  const lastInitial = nameParts.length > 1 ? nameParts[nameParts.length - 1][0] : "";
  const ts = Date.now().toString().slice(-4);
  return `${prefix}.${firstName}${lastInitial}.${ts}`;
}

/**
 * Generates a strong temporary password.
 * Pattern: <Uppercase><lowercase><digits><symbol>  — minimum 12 chars
 * e.g. Erp@4812XqR!
 */
export function generateTemporaryPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "@#$!%&";

  const pick = (str: string, n: number) =>
    Array.from({ length: n }, () => str[Math.floor(Math.random() * str.length)]).join("");

  const password = pick(upper, 3) + pick(lower, 3) + pick(digits, 3) + pick(symbols, 2) + pick(upper + lower, 2);
  // Shuffle
  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

/** Hashes a plain-text password with bcrypt (12 rounds) */
export async function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

/** Verifies a plain-text password against a bcrypt hash */
export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainText, hash);
}

/** Full credential provisioning result */
export interface ProvisionedCredentials {
  username: string;
  temporaryPassword: string; // plain-text — dispatch then discard
  passwordHash: string;      // store this in DB
  mustChangePassword: boolean;
}

/**
 * Provisions a complete set of credentials for a user.
 * Always sets mustChangePassword = true for first login.
 */
export async function provisionCredentials(
  fullName: string,
  role: string
): Promise<ProvisionedCredentials> {
  const username = generateUsername(fullName, role);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  return {
    username,
    temporaryPassword,
    passwordHash,
    mustChangePassword: true,
  };
}

/**
 * Simulates SMS & Email dispatch.
 * In production, replace with real SMS gateway (e.g. Twilio / BD SMS) and email service.
 */
export function dispatchCredentials(params: {
  fullName: string;
  phone?: string;
  email?: string;
  username: string;
  temporaryPassword: string;
  role: string;
}): void {
  const { fullName, phone, email, username, temporaryPassword, role } = params;

  console.log(`\n📧 [CREDENTIAL DISPATCH] ====================================`);
  console.log(`   Recipient : ${fullName} (${role})`);
  console.log(`   Username  : ${username}`);
  // The password itself is never logged.
  console.log(`   Phone     : ${phone || "N/A"}`);
  console.log(`   Email     : ${email || "N/A"}`);
  console.log(`   Via       : SMS + EMAIL`);
  console.log(`   Note      : User must change password on first login.`);
  console.log(`=============================================================\n`);

  // TODO (Production):
  // await smsService.send(phone, `Your ERP login: ${username} / ${temporaryPassword}`);
  // await emailService.send(email, "ERP Portal Credentials", template);
}

