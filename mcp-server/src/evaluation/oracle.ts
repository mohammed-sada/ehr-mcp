import { pool } from "../db/index.js";
import type { EvalTask } from "./types.js";
import { taskToSql } from "./sql.js";

/** Reference answer from the same SQL as ground-truth generation (full DB oracle). */
export async function runOracleAnswer(task: EvalTask): Promise<unknown> {
  const { text, values } = taskToSql(task);
  const r = await pool.query<{ expected_answer: unknown }>(text, values as unknown[]);
  return r.rows[0]?.expected_answer ?? null;
}
