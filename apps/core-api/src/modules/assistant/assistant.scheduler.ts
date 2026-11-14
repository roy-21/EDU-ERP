import { postgresService } from "../../database/postgres";
import { retryDueEscalations } from "./assistant-escalation.service";
import { backfillEmbeddings, processNextDocument } from "./assistant-knowledge.service";

// Background work: reading queued documents and retrying forwarded questions that failed to send.
// Both claim their rows in the database, so several API instances can run this safely.
export const startAssistantScheduler = (): void => {
  const seconds = Number(process.env.ASSISTANT_JOB_INTERVAL_SECONDS) || 30;
  const tick = async () => {
    if (!postgresService.isLive()) return;
    try {
      for (let index = 0; index < 10 && (await processNextDocument()); index += 1);
      await retryDueEscalations();
      for (let index = 0; index < 5 && (await backfillEmbeddings()) > 0; index += 1);
    } catch (err: any) {
      console.error("[Assistant Scheduler]", err.message);
    }
  };
  setTimeout(tick, 5_000).unref();
  setInterval(tick, seconds * 1000).unref();
  console.log(`[Assistant Scheduler] Documents and forwarded questions are checked every ${seconds}s.`);
};
