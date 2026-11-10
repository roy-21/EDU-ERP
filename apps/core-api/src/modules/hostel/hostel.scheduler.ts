import { postgresService } from "../../database/postgres";
import { generateInvoices } from "./hostel-billing.service";
import { applyLateFees, billFees } from "./hostel-fees.service";
import { deliverPending, queueDueReminders, queueMealReminders, queueNewInvoices } from "./hostel-notifications.service";
import { hostelGatewayService } from "./hostel-online-payment.service";
import { newId } from "./hostel.common";
import { generateSubscriptionInvoices } from "../identity/billing.service";

const CYCLE_LOCK_ID = 7420017;
const DEFAULT_INTERVAL_MINUTES = 15;
const FAST_JOB_INTERVAL_MINUTES = 5;
const FIRST_RUN_DELAY_MS = 30_000;

const allInstitutions = async (): Promise<string[]> => {
  const { rows } = await postgresService.query(
    `SELECT institution_id FROM hostel_allocations
     UNION SELECT institution_id FROM hostel_rent_settings`
  );
  return rows.map((row: any) => row.institution_id);
};

const forEachInstitution = async (work: (institutionId: string) => Promise<Record<string, number>>) => {
  const totals: Record<string, number> = {};
  const errors: string[] = [];
  const institutions = await allInstitutions();

  for (const institutionId of institutions) {
    try {
      const result = await work(institutionId);
      Object.entries(result).forEach(([key, value]) => {
        totals[key] = (totals[key] || 0) + value;
      });
    } catch (err: any) {
      errors.push(`${institutionId}: ${err.message}`);
    }
  }
  return { institutions: institutions.length, ...totals, errors };
};

// Balances come from a live view, and the dashboard reads them directly, so
// neither needs a job. Each job here is safe to repeat and catches up after downtime.
const JOBS = [
  {
    name: "invoice-generation",
    lockId: 7420101,
    run: () =>
      forEachInstitution(async (institutionId) => {
        const billing = await generateInvoices(institutionId);
        const fees = await billFees(institutionId);
        const lateFees = await applyLateFees(institutionId);
        const problems = [...billing.errors, ...fees.errors, ...lateFees.errors];
        if (problems.length > 0) throw new Error(problems.join("; "));
        const invoices = await queueNewInvoices(institutionId);
        return { invoicesCreated: billing.created + fees.created, lateFeesCreated: lateFees.created, invoiceEmailsQueued: invoices.queued };
      }),
    fast: false,
  },
  {
    name: "upcoming-reminders",
    lockId: 7420102,
    run: () =>
      forEachInstitution(async (institutionId) => ({
        remindersQueued: (await queueDueReminders(institutionId, { scope: "upcoming" })).queued,
      })),
    fast: false,
  },
  {
    name: "overdue-reminders",
    lockId: 7420103,
    run: () =>
      forEachInstitution(async (institutionId) => ({
        remindersQueued: (await queueDueReminders(institutionId, { scope: "overdue" })).queued,
        mealRemindersQueued: (await queueMealReminders(institutionId)).reduce((sum, item) => sum + item.queued, 0),
      })),
    fast: false,
  },
  {
    name: "subscription-billing",
    lockId: 7420106,
    run: async () => {
      const result = await generateSubscriptionInvoices();
      return { subscriptionInvoicesCreated: result.created, errors: result.errors };
    },
    fast: false,
  },
  {
    name: "payment-reconciliation",
    lockId: 7420104,
    run: () => hostelGatewayService.reconcileOpen(),
    fast: true,
  },
  {
    name: "notification-delivery",
    lockId: 7420105,
    run: async () => ({ ...(await deliverPending()), errors: [] as string[] }),
    fast: true,
  },
];

// The advisory lock stops two server instances running the same job together.
const runJob = async (job: (typeof JOBS)[number]): Promise<Record<string, any>> => {
  const startedAt = new Date();
  let failure = "";

  const details: Record<string, any> = await postgresService.transaction(async (tx) => {
    const lock = await tx.query("SELECT pg_try_advisory_xact_lock($1) AS acquired", [job.lockId]);
    if (!lock.rows[0].acquired) return { skipped: "Another instance is running this job." };
    try {
      return await job.run();
    } catch (err: any) {
      failure = err.message;
      return { errors: [err.message] };
    }
  });

  if (details.skipped) return details;

  const hasErrors = Boolean(failure) || (details.errors?.length ?? 0) > 0;
  await postgresService.query(
    "INSERT INTO hostel_job_runs (id, job, status, details, started_at) VALUES ($1, $2, $3, $4, $5)",
    [newId(), job.name, hasErrors ? "Failed" : "Success", JSON.stringify(details), startedAt]
  );
  await postgresService.query(
    "DELETE FROM hostel_job_runs WHERE job = $1 AND finished_at < NOW() - INTERVAL '30 days'",
    [job.name]
  );
  return details;
};

// Runs every job once, for the Run Now button.
export const runRentCycle = async (): Promise<Record<string, unknown>> =>
  postgresService.transaction(async (tx) => {
    const lock = await tx.query("SELECT pg_try_advisory_xact_lock($1) AS acquired", [CYCLE_LOCK_ID]);
    if (!lock.rows[0].acquired) return { skipped: "Another instance is running this job." };

    const summary = {
      institutions: 0,
      invoicesCreated: 0,
      remindersQueued: 0,
      paymentsChecked: 0,
      delivery: {} as Record<string, any>,
      errors: [] as string[],
    };
    for (const job of JOBS) {
      const result = await runJob(job);
      summary.errors.push(...(result.errors ?? []));
      summary.institutions = Math.max(summary.institutions, result.institutions ?? 0);
      summary.invoicesCreated += result.invoicesCreated ?? 0;
      summary.remindersQueued += result.remindersQueued ?? 0;
      summary.paymentsChecked += result.checked ?? 0;
      if (job.name === "notification-delivery") summary.delivery = result;
    }
    return summary;
  });

const jobRow = (row: any) => ({
  job: row.job,
  status: row.status,
  details: row.details,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

export const latestJobRun = async () => {
  const { rows } = await postgresService.query(
    "SELECT job, status, details, started_at, finished_at FROM hostel_job_runs ORDER BY finished_at DESC LIMIT 1"
  );
  return rows[0] ? jobRow(rows[0]) : null;
};

export const listJobStatus = async () => {
  const { rows } = await postgresService.query(
    `SELECT DISTINCT ON (job) job, status, details, started_at, finished_at
     FROM hostel_job_runs WHERE job = ANY($1) ORDER BY job, finished_at DESC`,
    [JOBS.map((job) => job.name)]
  );
  return JOBS.map((job) => {
    const last = rows.find((row: any) => row.job === job.name);
    return last ? jobRow(last) : { job: job.name, status: "Not Run", details: {}, startedAt: null, finishedAt: null };
  });
};

export const startHostelScheduler = (): void => {
  const minutes = Number(process.env.HOSTEL_JOB_INTERVAL_MINUTES) || DEFAULT_INTERVAL_MINUTES;

  JOBS.forEach((job) => {
    const tick = () => {
      runJob(job).catch((err) => console.error(`[Hostel Scheduler] ${job.name} failed:`, err.message));
    };
    const interval = job.fast ? Math.min(FAST_JOB_INTERVAL_MINUTES, minutes) : minutes;
    setTimeout(tick, FIRST_RUN_DELAY_MS).unref();
    setInterval(tick, interval * 60_000).unref();
  });
  console.log(`[Hostel Scheduler] Billing and reminders run every ${minutes} minute(s).`);
};
