import { postgresService } from "../../database/postgres";
import { HostelContext, HostelError, toIso, writeAudit } from "./hostel.common";
import { decryptSecret, encryptSecret, hasEncryptionKey } from "./hostel-secrets";

const REQUEST_TIMEOUT_MS = 30_000;
const PROVIDER = "bKash";
// bKash blocks an app for an hour after more than two grant calls in an hour.
const MAX_GRANTS_PER_HOUR = 2;
const TOKEN_RENEW_MARGIN_SECONDS = 300;
const REFRESH_LIFETIME_DAYS = 29;

// Grant Token is confirmed by bKash's v2 developer page. The other paths, the
// production host and the paymentId casing come from a third-party v2 client,
// because the official pages could not be read. Confirm them in the sandbox.
export const BKASH_BASE_URLS = {
  sandbox: "https://tokenized.sandbox.bka.sh/v2/tokenized-checkout",
  production: "https://tokenized.pay.bka.sh/v2/tokenized-checkout",
};
const PATHS = {
  grant: "/auth/grant-token",
  refresh: "/auth/refresh-token",
  create: "/payment/create",
  execute: "/payment/execute",
  query: "/query/payment",
};
const PAYMENT_ID_FIELD = "paymentId";

type Environment = keyof typeof BKASH_BASE_URLS;
type Credentials = { username: string; password: string; appKey: string; appSecret: string };

// bKash did not answer, so nothing is known about the payment yet.
export class GatewayUnavailable extends Error {}

export type GatewayAnswer = {
  statusCode: string;
  statusMessage: string;
  paymentId: string;
  trxId: string;
  transactionStatus: string;
  amount: string;
  currency: string;
  merchantInvoiceNumber: string;
  bkashUrl: string;
};

const normalize = (data: any): GatewayAnswer => ({
  statusCode: String(data?.statusCode ?? data?.errorCode ?? ""),
  statusMessage: String(data?.statusMessage ?? data?.errorMessage ?? ""),
  paymentId: String(data?.paymentID ?? data?.paymentId ?? ""),
  trxId: String(data?.trxID ?? data?.trxId ?? ""),
  transactionStatus: String(data?.transactionStatus ?? ""),
  amount: String(data?.amount ?? ""),
  currency: String(data?.currency ?? ""),
  merchantInvoiceNumber: String(data?.merchantInvoiceNumber ?? ""),
  bkashUrl: String(data?.bkashURL ?? data?.bkashUrl ?? ""),
});

const allowsTestBaseUrl = () =>
  process.env.BKASH_ALLOW_TEST_BASE_URL === "true" && process.env.NODE_ENV !== "production";

export const productionAllowed = () => process.env.HOSTEL_ALLOW_BKASH_PRODUCTION === "true";

const loadRow = async (institutionId: string) => {
  const { rows } = await postgresService.query(
    "SELECT * FROM hostel_gateway_config WHERE institution_id = $1 AND provider = $2",
    [institutionId, PROVIDER]
  );
  return rows[0] || null;
};

const credentialsOf = (row: any): Credentials | null =>
  row?.credentials_encrypted ? JSON.parse(decryptSecret(row.credentials_encrypted)) : null;

const baseUrlOf = (row: any): string =>
  allowsTestBaseUrl() && row.api_base_url
    ? row.api_base_url
    : BKASH_BASE_URLS[row.environment as Environment];

const post = async (url: string, headers: Record<string, string>, body: unknown) => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err: any) {
    throw new GatewayUnavailable(`Could not reach bKash: ${err.message}`);
  }
  if (response.status >= 500) throw new GatewayUnavailable(`bKash answered HTTP ${response.status}.`);
  const data: any = await response.json().catch(() => null);
  if (!data) throw new GatewayUnavailable(`bKash sent an unreadable answer (HTTP ${response.status}).`);
  return { status: response.status, data };
};

// The token lives in the database, so restarts and other servers reuse it
// instead of using up the grant limit. The row lock lets one caller renew it.
const getToken = async (institutionId: string): Promise<string> => {
  const outcome: { token?: string; error?: Error } = await postgresService.transaction(async (tx) => {
    const { rows } = await tx.query(
      "SELECT * FROM hostel_gateway_config WHERE institution_id = $1 AND provider = $2 FOR UPDATE",
      [institutionId, PROVIDER]
    );
    const row = rows[0];
    const credentials = credentialsOf(row);
    if (!row || !credentials) return { error: new HostelError(503, "bKash credentials are not configured.") };

    const margin = TOKEN_RENEW_MARGIN_SECONDS * 1000;
    if (row.token_encrypted && new Date(row.token_expires_at).getTime() - margin > Date.now()) {
      return { token: (JSON.parse(decryptSecret(row.token_encrypted)) as { id: string }).id };
    }

    const authHeaders = { username: credentials.username, password: credentials.password };
    const appBody = { app_key: credentials.appKey, app_secret: credentials.appSecret };
    const save = async (data: any, oldRefresh?: string) => {
      await tx.query(
        `UPDATE hostel_gateway_config SET token_encrypted = $3,
           token_expires_at = NOW() + ($4 || ' seconds')::interval,
           refresh_expires_at = NOW() + ($5 || ' days')::interval
         WHERE institution_id = $1 AND provider = $2`,
        [
          institutionId,
          PROVIDER,
          encryptSecret(JSON.stringify({ id: data.id_token, refresh: data.refresh_token || oldRefresh || "" })),
          String(Number(data.expires_in) || 3600),
          String(REFRESH_LIFETIME_DAYS),
        ]
      );
      return { token: data.id_token as string };
    };

    try {
      if (row.token_encrypted && row.refresh_expires_at && new Date(row.refresh_expires_at) > new Date()) {
        const { refresh } = JSON.parse(decryptSecret(row.token_encrypted));
        const answer = await post(`${baseUrlOf(row)}${PATHS.refresh}`, authHeaders, { ...appBody, refresh_token: refresh });
        if (answer.data.id_token) return await save(answer.data, refresh);
      }

      const hourAgo = Date.now() - 3_600_000;
      const recent: Date[] = (row.grant_times || []).filter((time: Date) => new Date(time).getTime() > hourAgo);
      if (recent.length >= MAX_GRANTS_PER_HOUR) {
        return {
          error: new HostelError(
            503,
            "bKash login was already attempted twice this hour. Waiting avoids a one-hour block by bKash. Try again later."
          ),
        };
      }

      await tx.query(
        "UPDATE hostel_gateway_config SET grant_times = $3 WHERE institution_id = $1 AND provider = $2",
        [institutionId, PROVIDER, [...recent, new Date()]]
      );
      const answer = await post(`${baseUrlOf(row)}${PATHS.grant}`, authHeaders, appBody);
      if (answer.data.id_token) return await save(answer.data);
      return {
        error: new HostelError(502, `bKash refused the login: ${normalize(answer.data).statusMessage || "no reason given"}.`),
      };
    } catch (err) {
      if (err instanceof GatewayUnavailable) return { error: err };
      throw err;
    }
  });

  // Returned rather than thrown, so the transaction commits and the grant attempt stays counted.
  if (outcome.error) throw outcome.error;
  return outcome.token as string;
};

const clearToken = (institutionId: string) =>
  postgresService.query(
    "UPDATE hostel_gateway_config SET token_encrypted = '', token_expires_at = NULL WHERE institution_id = $1 AND provider = $2",
    [institutionId, PROVIDER]
  );

const callApi = async (institutionId: string, path: string, body: unknown): Promise<GatewayAnswer> => {
  const row = await loadRow(institutionId);
  const credentials = credentialsOf(row);
  if (!credentials) throw new HostelError(503, "bKash credentials are not configured.");

  const attempt = async () =>
    post(
      `${baseUrlOf(row)}${path}`,
      { Authorization: await getToken(institutionId), "X-App-Key": credentials.appKey },
      body
    );

  let answer = await attempt();
  if (answer.status === 401) {
    await clearToken(institutionId);
    answer = await attempt();
  }
  return normalize(answer.data);
};

export const bkashApi = {
  createPayment: (
    institutionId: string,
    input: { amount: number; merchantInvoiceNumber: string; payerReference: string; callbackURL: string }
  ) =>
    callApi(institutionId, PATHS.create, {
      payerReference: input.payerReference,
      callbackURL: input.callbackURL,
      amount: input.amount.toFixed(2),
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: input.merchantInvoiceNumber,
    }),
  executePayment: (institutionId: string, paymentId: string) =>
    callApi(institutionId, PATHS.execute, { [PAYMENT_ID_FIELD]: paymentId }),
  queryPayment: (institutionId: string, paymentId: string) =>
    callApi(institutionId, PATHS.query, { [PAYMENT_ID_FIELD]: paymentId }),
};

const healthOf = (row: any): string => {
  if (!row?.credentials_encrypted) return "Not Configured";
  if (!row.enabled) return "Disabled";
  if (row.last_test_ok === true) return "Connected";
  if (row.last_test_ok === false) return "Error";
  return "Not Tested";
};

// Says which fields are set. Never returns a credential or token.
const publicView = (row: any) => {
  let stored: Partial<Credentials> = {};
  try {
    stored = credentialsOf(row) || {};
  } catch {
    stored = {};
  }
  return {
    provider: PROVIDER,
    environment: row?.environment || "sandbox",
    apiBaseUrl: row ? baseUrlOf(row) : BKASH_BASE_URLS.sandbox,
    enabled: row?.enabled === true,
    health: healthOf(row),
    hasUsername: Boolean(stored.username),
    hasPassword: Boolean(stored.password),
    hasAppKey: Boolean(stored.appKey),
    hasAppSecret: Boolean(stored.appSecret),
    lastTestAt: toIso(row?.last_test_at ?? null),
    lastTestMessage: row?.last_test_message || "",
    encryptionKeySet: hasEncryptionKey(),
    productionAllowed: productionAllowed(),
    sandboxBaseUrl: BKASH_BASE_URLS.sandbox,
    productionBaseUrl: BKASH_BASE_URLS.production,
  };
};

export const bkashConfig = {
  async get(institutionId: string) {
    return publicView(await loadRow(institutionId));
  },

  // Online checkout is on only when it is fully set up and not blocked.
  async isAvailable(institutionId: string): Promise<boolean> {
    const row = await loadRow(institutionId);
    if (!row?.enabled || !row.credentials_encrypted || !hasEncryptionKey()) return false;
    return row.environment !== "production" || productionAllowed();
  },

  async environmentOf(institutionId: string): Promise<string> {
    return (await loadRow(institutionId))?.environment || "sandbox";
  },

  async save(
    ctx: HostelContext,
    input: {
      environment: Environment;
      enabled: boolean;
      apiBaseUrl: string;
      username: string;
      password: string;
      appKey: string;
      appSecret: string;
    }
  ) {
    if (input.environment === "production" && !productionAllowed()) {
      throw new HostelError(
        400,
        "Production is blocked. Set HOSTEL_ALLOW_BKASH_PRODUCTION=true on the live server to use real money."
      );
    }
    if (input.apiBaseUrl && input.apiBaseUrl !== BKASH_BASE_URLS[input.environment] && !allowsTestBaseUrl()) {
      throw new HostelError(400, `The API address must be ${BKASH_BASE_URLS[input.environment]} for ${input.environment}.`);
    }

    const row = await loadRow(ctx.institutionId);
    const current = credentialsOf(row) || { username: "", password: "", appKey: "", appSecret: "" };
    // An empty field keeps the saved value, since saved values are never sent to the page.
    const next: Credentials = {
      username: input.username || current.username,
      password: input.password || current.password,
      appKey: input.appKey || current.appKey,
      appSecret: input.appSecret || current.appSecret,
    };
    const isComplete = Boolean(next.username && next.password && next.appKey && next.appSecret);
    if (input.enabled && !isComplete) {
      throw new HostelError(400, "Enter the username, password, app key and app secret before enabling bKash.");
    }

    const loginChanged =
      JSON.stringify(next) !== JSON.stringify(current) || (row && row.environment !== input.environment);
    const encrypted = Object.values(next).some(Boolean) ? encryptSecret(JSON.stringify(next)) : "";

    await postgresService.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO hostel_gateway_config (institution_id, provider, environment, api_base_url, enabled, credentials_encrypted)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (institution_id, provider) DO UPDATE SET environment = EXCLUDED.environment,
           api_base_url = EXCLUDED.api_base_url, enabled = EXCLUDED.enabled,
           credentials_encrypted = EXCLUDED.credentials_encrypted, updated_at = NOW()`,
        [ctx.institutionId, PROVIDER, input.environment, allowsTestBaseUrl() ? input.apiBaseUrl : "", input.enabled, encrypted]
      );
      if (loginChanged) {
        await tx.query(
          `UPDATE hostel_gateway_config SET token_encrypted = '', token_expires_at = NULL, refresh_expires_at = NULL,
             last_test_ok = NULL, last_test_at = NULL, last_test_message = ''
           WHERE institution_id = $1 AND provider = $2`,
          [ctx.institutionId, PROVIDER]
        );
      }
      await writeAudit(
        tx,
        ctx,
        "Updated",
        "Payment Config",
        PROVIDER,
        `bKash settings saved: ${input.environment}, ${input.enabled ? "enabled" : "disabled"}${loginChanged ? ", credentials changed" : ""}.`
      );
    });
    return publicView(await loadRow(ctx.institutionId));
  },

  // Uses the saved token when there is one, so a test cannot trigger bKash's grant block.
  async test(ctx: HostelContext) {
    let ok = false;
    let message: string;
    try {
      await getToken(ctx.institutionId);
      ok = true;
      message = "bKash accepted these credentials.";
    } catch (err: any) {
      message = String(err.message).slice(0, 500);
    }
    await postgresService.query(
      `UPDATE hostel_gateway_config SET last_test_at = NOW(), last_test_ok = $3, last_test_message = $4
       WHERE institution_id = $1 AND provider = $2`,
      [ctx.institutionId, PROVIDER, ok, message]
    );
    await postgresService.transaction((tx) =>
      writeAudit(tx, ctx, "Tested", "Payment Config", PROVIDER, `bKash connection test: ${ok ? "passed" : "failed"}.`)
    );
    return publicView(await loadRow(ctx.institutionId));
  },
};
