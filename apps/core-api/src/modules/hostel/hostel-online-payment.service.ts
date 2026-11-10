import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { GatewayAnswer, GatewayUnavailable, bkashApi, bkashConfig } from "./hostel-bkash.client";
import { invoiceStatus, postPayment } from "./hostel-billing.service";
import { hostelNotificationService } from "./hostel-notifications.service";
import {
  apiUrl,
  appUrl,
  findPaymentLink,
  hashSecret,
  isSecretShaped,
  newSecret,
} from "./hostel-payment-links";
import { getRentSettings, getToday } from "./hostel-rent.repository";
import { HostelContext, HostelError, newId, toIso, toMoney, writeAudit } from "./hostel.common";

const PROVIDER = "bKash";
const SUCCESS_CODE = "0000";
// While a checkout is open its amount is held, so two tabs cannot overpay an invoice.
const HOLD_MINUTES = 15;
const RECHECK_MINUTES = 5;
const GIVE_UP_HOURS = 48;
const ABANDONED_CREATE_MINUTES = 60;
// These mean the payment may still finish: not approved yet, or already completed.
const NOT_FINAL_CODES = new Set(["2054", "2056"]);
const MIN_AMOUNT = 1;

const gatewayActor = (institutionId: string): HostelContext => ({
  institutionId,
  actorId: "system",
  actorEmail: "bKash gateway",
});

const toCents = (value: number) => Math.round(value * 100);

const isCompleted = (answer: GatewayAnswer) =>
  answer.transactionStatus === "Completed" && (!answer.statusCode || answer.statusCode === SUCCESS_CODE);

const INVOICE_VIEW = `
  SELECT b.*,
    (SELECT COALESCE(SUM(o.outstanding_amount), 0) FROM hostel_invoice_balances o
      WHERE o.allocation_id = b.allocation_id AND o.billing_month < b.billing_month) AS earlier_outstanding
  FROM hostel_invoice_balances b`;

// Only what a student needs to recognise and pay a bill. No database ids, phone or NID.
const invoiceView = (row: any, today: string) => ({
  invoiceNumber: row.invoice_number,
  billingMonth: row.billing_month,
  monthlyRent: toMoney(row.amount_due),
  previousOutstanding: toMoney(row.earlier_outstanding),
  totalPayable: toMoney(row.earlier_outstanding) + toMoney(row.amount_due),
  paidAmount: toMoney(row.paid_amount),
  outstandingAmount: toMoney(row.outstanding_amount),
  dueDate: row.due_date,
  status: invoiceStatus(row, today),
});

export const hostelPortalService = {
  async getPage(token: string) {
    const link = await findPaymentLink(token);
    if (link.is_expired) {
      throw new HostelError(410, "This payment link has expired.");
    }

    const institutionId = link.institution_id;
    const [today, settings, available, invoices, payments] = await Promise.all([
      getToday(institutionId),
      getRentSettings(institutionId),
      bkashConfig.isAvailable(institutionId),
      postgresService.query(`${INVOICE_VIEW} WHERE b.allocation_id = $1 ORDER BY b.billing_month DESC`, [
        link.allocation_id,
      ]),
      postgresService.query(
        `SELECT p.id, p.amount, p.payment_date, p.method, p.receipt_number, p.status, p.transaction_reference, i.invoice_number
         FROM hostel_payments p JOIN hostel_invoices i ON i.id = p.invoice_id
         WHERE p.allocation_id = $1 ORDER BY p.created_at DESC`,
        [link.allocation_id]
      ),
    ]);

    const current = invoices.rows.find((row: any) => row.id === link.invoice_id);
    const environment = available ? await bkashConfig.environmentOf(institutionId) : "";
    const history = invoices.rows.map((row: any) => invoiceView(row, today));

    return {
      brandName: settings.brandName,
      student: { name: current.student_name, id: current.student_id },
      location: {
        hostel: current.hostel_name,
        building: current.building_name,
        room: current.room_number,
        seat: current.seat_number,
      },
      invoice: invoiceView(current, today),
      totalOutstanding: history.reduce((sum: number, row: any) => sum + toCents(row.outstandingAmount), 0) / 100,
      invoices: history,
      payments: payments.rows.map((row: any) => ({
        // Receipts are fetched through this reference together with the token.
        reference: row.id,
        amount: toMoney(row.amount),
        paymentDate: row.payment_date,
        method: row.method,
        receiptNumber: row.receipt_number,
        status: row.status,
        transactionReference: row.transaction_reference,
        invoiceNumber: row.invoice_number,
      })),
      online: {
        bkash: available,
        sandbox: environment === "sandbox",
        allowPartial: settings.allowPartialOnline,
        minAmount: MIN_AMOUNT,
      },
    };
  },

  async requestNewLink(token: string) {
    const link = await findPaymentLink(token);
    if (!link.is_expired) throw new HostelError(409, "This link is still valid.");
    await hostelNotificationService.sendNewPaymentLink(link.institution_id, link.invoice_id);
  },

  // Only a payment of the same student can be opened with this link.
  async assertReceiptAccess(token: string, paymentId: string) {
    const link = await findPaymentLink(token);
    if (link.is_expired) throw new HostelError(410, "This payment link has expired.");
    const { rows } = await postgresService.query(
      "SELECT id FROM hostel_payments WHERE id = $1 AND allocation_id = $2",
      [paymentId, link.allocation_id]
    );
    if (!rows[0]) throw new HostelError(404, "Receipt not found.");
    return link.institution_id;
  },

  async startCheckout(token: string, input: { amount: unknown; invoiceNumber: unknown }) {
    const link = await findPaymentLink(token);
    if (link.is_expired) throw new HostelError(410, "This payment link has expired.");
    const institutionId = link.institution_id;

    if (!(await bkashConfig.isAvailable(institutionId))) {
      throw new HostelError(409, "Online payment is not available right now.");
    }

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || toCents(amount) / 100 !== amount || amount < MIN_AMOUNT) {
      throw new HostelError(400, `Enter an amount of at least BDT ${MIN_AMOUNT}, with up to 2 decimal places.`);
    }

    const settings = await getRentSettings(institutionId);
    const callbackSecret = newSecret();

    // The hold is decided while the invoice is locked, so two requests cannot both pass.
    const prepared = await postgresService.transaction(async (tx) => {
      const lookup = input.invoiceNumber
        ? await tx.query(
            "SELECT id FROM hostel_invoices WHERE allocation_id = $1 AND invoice_number = $2 FOR UPDATE",
            [link.allocation_id, String(input.invoiceNumber)]
          )
        : await tx.query("SELECT id FROM hostel_invoices WHERE id = $1 FOR UPDATE", [link.invoice_id]);
      if (!lookup.rows[0]) throw new HostelError(404, "Invoice not found.");
      const invoiceId = lookup.rows[0].id;

      const { rows } = await tx.query("SELECT * FROM hostel_invoice_balances WHERE id = $1", [invoiceId]);
      const invoice = rows[0];
      const outstanding = toMoney(invoice.outstanding_amount);
      if (outstanding <= 0) throw new HostelError(409, "This invoice has already been paid.");

      if (!settings.allowPartialOnline && toCents(amount) !== toCents(outstanding)) {
        throw new HostelError(400, `Part payment is not enabled. Pay the full BDT ${outstanding}.`);
      }

      const open = await tx.query(
        `SELECT amount, checkout_url FROM hostel_gateway_transactions
         WHERE invoice_id = $1 AND status IN ('Created', 'Initiated')
           AND created_at > NOW() - ($2 || ' minutes')::interval`,
        [invoiceId, String(HOLD_MINUTES)]
      );
      // Opening the same payment again continues it instead of starting a second one.
      const same = open.rows.find((row: any) => toCents(toMoney(row.amount)) === toCents(amount) && row.checkout_url);
      if (same) return { resumeUrl: same.checkout_url as string };

      const held = open.rows.reduce((sum: number, row: any) => sum + toCents(toMoney(row.amount)), 0);
      if (toCents(amount) + held > toCents(outstanding)) {
        if (toCents(amount) > toCents(outstanding)) {
          throw new HostelError(400, `The amount is more than the BDT ${outstanding} outstanding on this invoice.`);
        }
        throw new HostelError(409, `A payment on this invoice is in progress. Finish it, or try again in ${HOLD_MINUTES} minutes.`);
      }

      const id = newId();
      const merchantInvoiceNumber = `${invoice.invoice_number}-${newSecret().slice(0, 6)}`;
      await tx.query(
        `INSERT INTO hostel_gateway_transactions (id, institution_id, provider, environment, invoice_id,
           allocation_id, callback_hash, merchant_invoice_number, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          institutionId,
          PROVIDER,
          await bkashConfig.environmentOf(institutionId),
          invoiceId,
          link.allocation_id,
          hashSecret(callbackSecret),
          merchantInvoiceNumber,
          amount,
        ]
      );
      return { id, merchantInvoiceNumber, studentId: invoice.student_id as string };
    });

    if ("resumeUrl" in prepared) return { checkoutUrl: prepared.resumeUrl };

    const setFailed = (message: string, code = "") =>
      postgresService.query(
        "UPDATE hostel_gateway_transactions SET status = 'Failed', status_code = $2, status_message = $3, updated_at = NOW() WHERE id = $1",
        [prepared.id, code, message.slice(0, 500)]
      );

    let answer: GatewayAnswer;
    try {
      answer = await bkashApi.createPayment(institutionId, {
        amount,
        merchantInvoiceNumber: prepared.merchantInvoiceNumber,
        payerReference: prepared.studentId,
        callbackURL: `${apiUrl()}/api/v1/public/hostel/bkash/callback/${callbackSecret}`,
      });
    } catch (err: any) {
      // The student was never sent to bKash, so no money can have moved.
      await setFailed(err.message);
      if (err instanceof GatewayUnavailable) throw new HostelError(503, "bKash is not reachable right now. Please try again.");
      throw err;
    }

    if (answer.statusCode !== SUCCESS_CODE || !answer.bkashUrl || !answer.paymentId) {
      await setFailed(answer.statusMessage || "bKash did not start the payment.", answer.statusCode);
      throw new HostelError(502, answer.statusMessage || "bKash could not start this payment. Please try again.");
    }

    await postgresService.query(
      `UPDATE hostel_gateway_transactions SET status = 'Initiated', gateway_payment_id = $2, checkout_url = $3,
         status_code = $4, status_message = $5, next_check_at = NOW() + ($6 || ' minutes')::interval, updated_at = NOW()
       WHERE id = $1`,
      [prepared.id, answer.paymentId, answer.bkashUrl, answer.statusCode, answer.statusMessage.slice(0, 500), String(RECHECK_MINUTES)]
    );
    return { checkoutUrl: answer.bkashUrl };
  },
};

const updateStatus = (tx: PoolClient, id: string, status: string, answer: GatewayAnswer | null, extra = "") =>
  tx.query(
    `UPDATE hostel_gateway_transactions SET status = $2, status_code = COALESCE($3, status_code),
       status_message = COALESCE($4, status_message), review_reason = $5, updated_at = NOW()
     WHERE id = $1`,
    [id, status, answer?.statusCode ?? null, answer ? answer.statusMessage.slice(0, 500) : null, extra]
  );

// Why this answer cannot be accepted automatically, or null when everything matches.
const findProblem = async (tx: PoolClient, row: any, answer: GatewayAnswer): Promise<string | null> => {
  if (!answer.trxId) return "bKash reported completion without a transaction ID.";
  if (answer.paymentId && answer.paymentId !== row.gateway_payment_id) return "The payment ID does not match.";
  if (answer.amount === "" || toCents(Number(answer.amount)) !== toCents(toMoney(row.amount))) {
    return `bKash reported ${answer.amount || "no amount"}, but ${toMoney(row.amount)} was requested.`;
  }
  if (answer.currency && answer.currency !== "BDT") return `The currency is ${answer.currency}.`;
  if (answer.merchantInvoiceNumber && answer.merchantInvoiceNumber !== row.merchant_invoice_number) {
    return "The invoice reference does not match.";
  }

  const usedByGateway = await tx.query(
    "SELECT id FROM hostel_gateway_transactions WHERE provider = $1 AND trx_id = $2 AND id <> $3",
    [PROVIDER, answer.trxId, row.id]
  );
  if (usedByGateway.rows[0]) return `Transaction ${answer.trxId} was already used on another payment.`;

  const usedManually = await tx.query(
    "SELECT id FROM hostel_payments WHERE institution_id = $1 AND LOWER(transaction_reference) = LOWER($2) AND status = 'Confirmed'",
    [row.institution_id, answer.trxId]
  );
  if (usedManually.rows[0]) return `Transaction ${answer.trxId} is already recorded on a payment.`;

  await tx.query("SELECT id FROM hostel_invoices WHERE id = $1 FOR UPDATE", [row.invoice_id]);
  const invoice = await tx.query("SELECT outstanding_amount FROM hostel_invoice_balances WHERE id = $1", [row.invoice_id]);
  if (toCents(toMoney(row.amount)) > toCents(toMoney(invoice.rows[0].outstanding_amount))) {
    return `bKash took ${toMoney(row.amount)}, which is more than the ${toMoney(invoice.rows[0].outstanding_amount)} still owed. A refund may be needed.`;
  }
  return null;
};

type SettleEffect = { type: "paid"; payment: any } | { type: "failed" } | { type: "review"; reason: string } | { type: "none" };

const finalize = async (tx: PoolClient, row: any, answer: GatewayAnswer): Promise<SettleEffect> => {
  const ctx = gatewayActor(row.institution_id);
  const problem = await findProblem(tx, row, answer);

  if (problem) {
    await updateStatus(tx, row.id, "Review", answer, problem);
    await writeAudit(tx, ctx, "Review", "Payment", row.id, `bKash payment ${row.merchant_invoice_number} needs review: ${problem}`);
    return { type: "review", reason: problem };
  }

  const payment = await postPayment(tx, ctx, row.invoice_id, {
    amount: toMoney(row.amount),
    paymentDate: await getToday(row.institution_id),
    method: PROVIDER,
    transactionReference: answer.trxId,
    notes: `Online payment ${row.merchant_invoice_number}`,
    idempotencyKey: `gateway:${row.id}`,
  });
  await tx.query(
    `UPDATE hostel_gateway_transactions SET status = 'Completed', trx_id = $2, payment_id = $3, completed_at = NOW(),
       status_code = $4, status_message = $5, updated_at = NOW()
     WHERE id = $1`,
    [row.id, answer.trxId, payment.id, answer.statusCode || SUCCESS_CODE, answer.statusMessage.slice(0, 500)]
  );
  return { type: "paid", payment };
};

const ask = async (call: () => Promise<GatewayAnswer>): Promise<GatewayAnswer | null> => {
  try {
    return await call();
  } catch (err) {
    if (err instanceof GatewayUnavailable) return null;
    throw err;
  }
};

const runAfterSettle = async (row: any, effect: SettleEffect) => {
  const institutionId = row.institution_id;
  try {
    if (effect.type === "paid") {
      await hostelNotificationService.sendPaymentConfirmation(institutionId, effect.payment);
    }
    if (effect.type === "failed") {
      await hostelNotificationService.sendPaymentFailure(institutionId, row.id, row.invoice_id);
    }
    if (effect.type === "review") {
      await hostelNotificationService.alertAdmin(
        institutionId,
        `gateway:${row.id}`,
        "A bKash rent payment needs review",
        `Payment ${row.merchant_invoice_number} was not applied to the invoice. Reason: ${effect.reason}`
      );
    }
  } catch (err: any) {
    // The payment is saved, and the outbox retries anything already queued.
    console.error("[Hostel Payment] Message after settlement failed:", err.message);
  }
};

// The only place a gateway payment changes the books. Holding the row lock through
// the bKash call means repeated callbacks wait here, then see the final status.
export const settleTransaction = async (
  id: string,
  signal: "success" | "failure" | "cancel" | "reconcile"
): Promise<void> => {
  const outcome = await postgresService.transaction(async (tx) => {
    const { rows } = await tx.query("SELECT * FROM hostel_gateway_transactions WHERE id = $1 FOR UPDATE", [id]);
    const row = rows[0];
    if (!row || row.status !== "Initiated") return { row, effect: { type: "none" } as SettleEffect };

    const institutionId: string = row.institution_id;
    const paymentId: string = row.gateway_payment_id;
    const query = () => ask(() => bkashApi.queryPayment(institutionId, paymentId));
    const execute = () => ask(() => bkashApi.executePayment(institutionId, paymentId));
    const later = async () => {
      await tx.query(
        "UPDATE hostel_gateway_transactions SET next_check_at = NOW() + ($2 || ' minutes')::interval, updated_at = NOW() WHERE id = $1",
        [id, String(RECHECK_MINUTES)]
      );
      return { row, effect: { type: "none" } as SettleEffect };
    };

    // A redirect only says what the browser saw, so bKash is always asked.
    if (signal === "failure" || signal === "cancel") {
      const status = await query();
      if (!status) return later();
      if (isCompleted(status)) return { row, effect: await finalize(tx, row, status) };
      await updateStatus(tx, id, signal === "cancel" ? "Cancelled" : "Failed", status);
      return { row, effect: { type: signal === "cancel" ? "none" : "failed" } as SettleEffect };
    }

    if (signal === "reconcile") {
      const status = await query();
      if (status && isCompleted(status)) return { row, effect: await finalize(tx, row, status) };
    }

    const executed = await execute();
    if (executed && isCompleted(executed)) return { row, effect: await finalize(tx, row, executed) };

    // A failed or timed-out execute may still have taken the money, so the query decides.
    const status = signal === "reconcile" && !executed ? null : await query();
    if (status && isCompleted(status)) return { row, effect: await finalize(tx, row, status) };

    if (executed && !NOT_FINAL_CODES.has(executed.statusCode) && executed.statusCode !== SUCCESS_CODE) {
      await updateStatus(tx, id, "Failed", executed);
      return { row, effect: { type: "failed" } as SettleEffect };
    }

    const ageHours = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;
    if (signal === "reconcile" && ageHours >= GIVE_UP_HOURS) {
      await updateStatus(tx, id, "Expired", status || executed);
      return { row, effect: { type: "none" } as SettleEffect };
    }
    return later();
  });

  if (outcome.row) await runAfterSettle(outcome.row, outcome.effect);
};

const findByCallback = async (secret: string) => {
  if (!isSecretShaped(secret)) return null;
  const { rows } = await postgresService.query(
    "SELECT * FROM hostel_gateway_transactions WHERE callback_hash = $1",
    [hashSecret(secret)]
  );
  return rows[0] || null;
};

export const hostelGatewayService = {
  // The secret in the address proves this callback belongs to this checkout.
  async handleCallback(secret: string, query: { paymentID?: unknown; paymentId?: unknown; status?: unknown }) {
    const row = await findByCallback(secret);
    const resultUrl = `${appUrl()}/hostel/payment/result/${encodeURIComponent(secret)}`;
    if (!row) return resultUrl;

    const reported = String(query.paymentID ?? query.paymentId ?? "");
    if (reported !== row.gateway_payment_id) return resultUrl;

    const status = query.status === "success" ? "success" : query.status === "cancel" ? "cancel" : "failure";
    await settleTransaction(row.id, status);
    return resultUrl;
  },

  async getResult(secret: string) {
    const row = await findByCallback(secret);
    if (!row) throw new HostelError(404, "Payment not found.");

    const { rows } = await postgresService.query(
      `SELECT b.invoice_number, b.billing_month, b.student_name, b.student_id, b.outstanding_amount, s.brand_name, p.receipt_number
       FROM hostel_invoice_balances b
       LEFT JOIN hostel_rent_settings s ON s.institution_id = b.institution_id
       LEFT JOIN hostel_payments p ON p.id = $2
       WHERE b.id = $1`,
      [row.invoice_id, row.payment_id]
    );
    const invoice = rows[0];
    return {
      status: row.status,
      amount: toMoney(row.amount),
      brandName: invoice.brand_name || "Hostel Office",
      invoiceNumber: invoice.invoice_number,
      billingMonth: invoice.billing_month,
      studentName: invoice.student_name,
      studentId: invoice.student_id,
      remainingBalance: toMoney(invoice.outstanding_amount),
      trxId: row.status === "Completed" ? row.trx_id : "",
      receiptNumber: row.status === "Completed" ? invoice.receipt_number : "",
      message: row.status === "Failed" ? row.status_message : "",
    };
  },

  async getResultReceiptPayment(secret: string) {
    const row = await findByCallback(secret);
    if (!row?.payment_id) throw new HostelError(404, "Receipt not found.");
    return { institutionId: row.institution_id as string, paymentId: row.payment_id as string };
  },

  // Finds payments whose browser never came back, including a closed tab after the PIN.
  async reconcileOpen(options: { institutionId?: string } = {}) {
    const abandoned = await postgresService.query(
      `UPDATE hostel_gateway_transactions SET status = 'Expired', updated_at = NOW()
       WHERE status = 'Created' AND created_at < NOW() - ($1 || ' minutes')::interval`,
      [String(ABANDONED_CREATE_MINUTES)]
    );

    const values: unknown[] = [];
    if (options.institutionId) values.push(options.institutionId);
    const { rows } = await postgresService.query(
      `SELECT id, status FROM hostel_gateway_transactions
       WHERE status = 'Initiated' AND next_check_at <= NOW()
         ${options.institutionId ? "AND institution_id = $1" : ""}
       ORDER BY next_check_at LIMIT 100`,
      values
    );

    const errors: string[] = [];
    for (const { id } of rows) {
      try {
        await settleTransaction(id, "reconcile");
      } catch (err: any) {
        errors.push(`${id}: ${err.message}`);
      }
    }
    return { checked: rows.length, abandoned: abandoned.rowCount ?? 0, errors };
  },

  async list(institutionId: string, limit = 200) {
    const { rows } = await postgresService.query(
      `SELECT t.*, i.invoice_number, i.student_name, i.student_id, i.billing_month, p.receipt_number
       FROM hostel_gateway_transactions t
       JOIN hostel_invoices i ON i.id = t.invoice_id
       LEFT JOIN hostel_payments p ON p.id = t.payment_id
       WHERE t.institution_id = $1 ORDER BY t.created_at DESC LIMIT $2`,
      [institutionId, limit]
    );
    return rows.map((row: any) => ({
      id: row.id,
      provider: row.provider,
      environment: row.environment,
      invoiceNumber: row.invoice_number,
      studentName: row.student_name,
      studentId: row.student_id,
      billingMonth: row.billing_month,
      allocationId: row.allocation_id,
      amount: toMoney(row.amount),
      status: row.status,
      trxId: row.trx_id,
      receiptNumber: row.receipt_number,
      statusMessage: row.status_message,
      reviewReason: row.review_reason,
      createdAt: toIso(row.created_at),
      completedAt: toIso(row.completed_at),
    }));
  },

  async verifyNow(ctx: HostelContext, id: string) {
    const found = await postgresService.query(
      "SELECT id, status FROM hostel_gateway_transactions WHERE institution_id = $1 AND id = $2",
      [ctx.institutionId, id]
    );
    if (!found.rows[0]) throw new HostelError(404, "Transaction not found.");
    if (found.rows[0].status !== "Initiated") {
      throw new HostelError(409, `This payment is already ${found.rows[0].status}.`);
    }
    await settleTransaction(id, "reconcile");

    const { rows } = await postgresService.query("SELECT status FROM hostel_gateway_transactions WHERE id = $1", [id]);
    await postgresService.transaction((tx) =>
      writeAudit(tx, ctx, "Verified", "Payment", id, `Checked an online payment with bKash. Status: ${rows[0].status}.`)
    );
    return { id, status: rows[0].status };
  },
};
