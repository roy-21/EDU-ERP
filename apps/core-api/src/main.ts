import { createApp } from "./app";
import { config } from "./config/environment";
import { postgresService } from "./database/postgres";
import { validateEmailConfig } from "./modules/hostel/hostel-email.service";
import { hasEncryptionKey } from "./modules/hostel/hostel-secrets";
import { startHostelScheduler } from "./modules/hostel/hostel.scheduler";
import { startInventoryScheduler } from "./modules/inventory/inventory-alerts.service";

async function bootstrap() {
  // Initialize Production PostgreSQL Database Connection
  await postgresService.initialize();

  const app = createApp();

  if (postgresService.isLive()) {
    startHostelScheduler();
    startInventoryScheduler();
    await validateEmailConfig();
    if (!hasEncryptionKey()) {
      console.warn("[Hostel Payment] HOSTEL_SECRET_KEY is not set. bKash credentials cannot be saved.");
    }
  }

  app.listen(config.port, () => {
    console.log(`=================================================`);
    console.log(`🚀 Core ERP Modular Backend Running on Port ${config.port}`);
    console.log(`   Database Mode: ${postgresService.isLive() ? "PostgreSQL 16 (Live)" : "High-Availability Resilient Store"}`);
    console.log(`   Health Check:  http://localhost:${config.port}/api/v1/health`);
    console.log(`   Environment:   ${config.nodeEnv}`);
    console.log(`=================================================`);
  });
}

bootstrap().catch((err) => {
  console.error("Fatal startup error in Core ERP Backend:", err);
  process.exit(1);
});
