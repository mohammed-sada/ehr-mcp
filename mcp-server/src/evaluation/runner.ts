import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pool } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { tasks } from "./tasks.js";
import type { GroundTruthRow } from "./types.js";
import { taskToSql } from "./sql.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUTPUT_PATH = resolve(__dirname, "output", "ground_truth.json");

async function runOne(taskId: number): Promise<GroundTruthRow> {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) {
    return {
      task_id: taskId,
      type: "simple",
      question: "Unknown task",
      subject_id: -1,
      expected_answer: { error: "Task not found" }
    };
  }

  logger.info(`Running task ${task.id}...`);

  try {
    const { text, values } = taskToSql(task);
    const r = await pool.query<{ expected_answer: unknown }>(text, values as any[]);
    const expected = r.rows[0]?.expected_answer ?? null;

    logger.info(`Task ${task.id} success`);

    return {
      task_id: task.id,
      type: task.type,
      question: task.question,
      subject_id: task.subject_id,
      expected_answer: expected
    };
  } catch (err) {
    logger.error(`Task ${task.id} failed`, err);
    return {
      task_id: task.id,
      type: task.type,
      question: task.question,
      subject_id: task.subject_id,
      expected_answer: {
        error: "Query failed",
        details: err instanceof Error ? { name: err.name, message: err.message } : err
      }
    };
  }
}

export async function generateGroundTruth(): Promise<GroundTruthRow[]> {
  const out: GroundTruthRow[] = [];
  for (const task of tasks) {
    // Run sequentially for clarity/debuggability (evaluation correctness > speed)
    // eslint-disable-next-line no-await-in-loop
    out.push(await runOne(task.id));
  }
  return out;
}

async function main() {
  let rows: GroundTruthRow[] = [];
  try {
    rows = await generateGroundTruth();
  } finally {
    // Always write output, even if some tasks failed.
    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, JSON.stringify(rows, null, 2), "utf8");
    logger.info(`Wrote ground truth to ${OUTPUT_PATH}`);
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  logger.error("Ground truth generation failed", err);
  process.exit(1);
});

