import { Pool, PoolClient } from "pg";
import fs from "fs";
import path from "path";
import { seedIdentity } from "../modules/identity/identity.seed";

const SCHEMA_MIGRATION_LOCK = 7420001;

class PostgresDatabaseService {
  private pool: Pool | null = null;
  private isConnected: boolean = false;

  constructor() {
    const connectionString =
      process.env.ERP_DATABASE_URL ||
      process.env.DATABASE_URL ||
      "postgresql://erp_user:erp_secret@localhost:5432/erp_db";

    try {
      this.pool = new Pool({
        connectionString,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 10000,
        max: 20
      });
    } catch (err: any) {
      console.warn("Failed to initialize PostgreSQL pool:", err.message);
    }
  }

  /**
   * Initializes PostgreSQL Database and runs DDL schema migrations
   */
  public async initialize(): Promise<boolean> {
    if (!this.pool) return false;

    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();
      this.isConnected = true;
      console.log("✅ [PostgreSQL] Connected successfully to Core ERP Database.");

      // Run Schema Migration
      const schemaPath = path.join(__dirname, "schema.sql");
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, "utf-8");
        // Servers starting together take turns, so their migrations cannot collide.
        await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_MIGRATION_LOCK]);
        try {
          await client.query(schemaSql);
          // Inside the lock, so two servers starting together cannot seed twice.
          await seedIdentity(client);
        } finally {
          await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_MIGRATION_LOCK]);
        }
        console.log("✅ [PostgreSQL] Database schema tables migrated successfully.");
      }

      // Seed Initial Institution if empty
      const instCheck = await client.query("SELECT COUNT(*) FROM institutions");
      if (parseInt(instCheck.rows[0].count, 10) === 0) {
        await client.query(`
          INSERT INTO institutions (id, code, name, type, currency, status)
          VALUES ('018e3d8f-74a0-7b3e-8c1d-612a4b89ef12', 'DU', 'Dhaka University Campus', 'University', 'BDT', 'ACTIVE');
          
          INSERT INTO system_settings (institution_id, system_name, support_email, currency)
          VALUES ('018e3d8f-74a0-7b3e-8c1d-612a4b89ef12', 'NextGen Institutional ERP System', 'support@institution.edu', 'BDT');
        `);
        console.log("🌱 [PostgreSQL] Seeded default institution record.");
      }

      return true;
    } catch (err: any) {
      this.isConnected = false;
      console.warn(
        `⚠️ [PostgreSQL Offline] Could not connect to PostgreSQL at localhost:5432 (${err.message}).`
      );
      console.log(
        "💡 [Production Note] Run 'docker compose up -d erp-postgres' to enable full PostgreSQL persistence."
      );
      return false;
    } finally {
      if (client) client.release();
    }
  }

  public isLive(): boolean {
    return this.isConnected;
  }

  public async query(text: string, params?: any[]): Promise<any> {
    if (!this.pool || !this.isConnected) {
      throw new Error("PostgreSQL is not connected");
    }
    return this.pool.query(text, params);
  }

  public async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool || !this.isConnected) {
      throw new Error("PostgreSQL is not connected");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

export const postgresService = new PostgresDatabaseService();

