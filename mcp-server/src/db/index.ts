import pg from "pg";
import { env } from "../config/index.js";
import { logger } from "../utils/logger.js";

const { Pool } = pg;

export const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  max: env.DB_MAX,
  idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS
});

pool.on("error", (err) => {
  logger.error("Postgres pool error", err);
});

export async function healthcheck(): Promise<{ ok: boolean; now?: string }> {
  const r = await pool.query<{ now: string }>("select now() as now");
  return { ok: true, now: r.rows[0]?.now };
}

