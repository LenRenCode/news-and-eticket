import { Pool, PoolClient } from "pg";
import dotenv from "dotenv";
import { executeMemoryQuery, withMemoryLock } from "./memory-db";
import { isProductionMode } from "./app-mode";

dotenv.config({ path: "../../.env" });
dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/eticket?schema=public";

let pgAvailable: boolean | null = null;

const realPool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Deteksi ketersediaan PostgreSQL
export async function checkPostgres(): Promise<boolean> {
  if (pgAvailable !== null) return pgAvailable;
  try {
    const client = await realPool.connect();
    client.release();
    pgAvailable = true;
    console.log("[Database] Terhubung ke PostgreSQL (Mandatory Mode).");
    return true;
  } catch (err: any) {
    pgAvailable = false;
    if (isProductionMode()) {
      throw new Error(
        "PostgreSQL tidak tersedia; database in-memory dinonaktifkan di mode production.",
        { cause: err }
      );
    }
    console.warn(`[Database Warning] PostgreSQL tidak dapat diakses (${err.message}).`);
    console.log(
      "[Database Info] Mengaktifkan In-Memory Database (Mock Mode) otomatis untuk pengujian langsung."
    );
    return false;
  }
}

// Wrapper query yang otomatis fallback jika PostgreSQL offline
export const pool = {
  async query(text: string, params?: any[]): Promise<{ rows: any[] }> {
    const isPg = await checkPostgres();
    if (isPg) {
      try {
        return await realPool.query(text, params);
      } catch (err: any) {
        if (
          err.code === "ECONNREFUSED" ||
          err.code === "ETIMEDOUT" ||
          err.message?.includes("connect")
        ) {
          pgAvailable = false;
          if (isProductionMode()) {
            throw new Error(
              "PostgreSQL tidak tersedia; database in-memory dinonaktifkan di mode production.",
              { cause: err }
            );
          }
          return await executeMemoryQuery(text, params);
        }
        throw err;
      }
    }
    if (isProductionMode()) {
      throw new Error(
        "PostgreSQL tidak tersedia; database in-memory dinonaktifkan di mode production."
      );
    }
    return await executeMemoryQuery(text, params);
  },
};

/**
 * Helper untuk menjalankan query di dalam transaction dengan commit/rollback otomatis.
 * Mendukung PostgreSQL Row Locking (FOR UPDATE) dan Fallback In-Memory Lock.
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const isPg = await checkPostgres();
  if (!isPg && isProductionMode()) {
    throw new Error(
      "PostgreSQL tidak tersedia; database in-memory dinonaktifkan di mode production."
    );
  }

  if (isPg) {
    try {
      const client = await realPool.connect();
      try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (err: any) {
      if (
        err.code === "ECONNREFUSED" ||
        err.code === "ETIMEDOUT" ||
        err.message?.includes("connect")
      ) {
        pgAvailable = false;
        if (isProductionMode()) {
          throw new Error(
            "PostgreSQL tidak tersedia; database in-memory dinonaktifkan di mode production.",
            { cause: err }
          );
        }
      } else {
        throw err;
      }
    }
  }

  // Fallback In-Memory Transaction dengan Memory Mutex Lock
  return await withMemoryLock(async () => {
    const mockClient = {
      query: async (text: string, params?: any[]) => {
        return await executeMemoryQuery(text, params);
      },
      release: () => {},
    } as unknown as PoolClient;

    return await callback(mockClient);
  });
}
