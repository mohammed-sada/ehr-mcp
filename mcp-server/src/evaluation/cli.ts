#!/usr/bin/env node
/**
 * Evaluation CLI
 *
 * Usage:
 *   npm run evaluate -- oracle
 *     Re-runs SQL oracle for every task and checks against ground_truth.json (sanity: expect 20/20).
 *
 *   npm run evaluate -- score --predictions path/to/predictions.json
 *     Scores a JSON file of { "predictions": [ { "task_id": 1, "answer": ... }, ... ] }.
 *
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pool } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { summarizeScores, scoreAgainstExpected, normalizeForCompare } from "./compare.js";
import { runOracleAnswer } from "./oracle.js";
import { tasks } from "./tasks.js";
import type { GroundTruthRow } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_GT = resolve(__dirname, "output", "ground_truth.json");

interface PredictionsFile {
  predictions: { task_id: number; answer: unknown }[];
}

async function loadGroundTruth(path: string): Promise<GroundTruthRow[]> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as GroundTruthRow[];
}

function gtMap(rows: GroundTruthRow[]): Map<number, GroundTruthRow> {
  const m = new Map<number, GroundTruthRow>();
  for (const r of rows) m.set(r.task_id, r);
  return m;
}

async function cmdOracle(gtPath: string): Promise<void> {
  const gt = await loadGroundTruth(gtPath);
  const map = gtMap(gt);
  const scores = [];

  for (const task of tasks) {
    const row = map.get(task.id);
    if (!row) {
      scores.push({ task_id: task.id, pass: false, detail: "missing ground truth row" });
      logger.error(`No ground truth for task ${task.id}`);
      continue;
    }
    const actual = await runOracleAnswer(task);
    const sc = scoreAgainstExpected(task.id, row.expected_answer, actual);
    scores.push(sc);
    if (!sc.pass) {
      logger.warn(`Task ${task.id} oracle mismatch`, {
        expected: normalizeForCompare(row.expected_answer),
        actual: normalizeForCompare(actual)
      });
    }
  }

  const summary = summarizeScores(scores);
  printSummary(summary, "oracle (SQL reference)");
}

async function cmdScore(gtPath: string, predPath: string): Promise<void> {
  const gt = await loadGroundTruth(gtPath);
  const map = gtMap(gt);
  const predRaw = await readFile(predPath, "utf8");
  const pred = JSON.parse(predRaw) as PredictionsFile;
  if (!pred.predictions || !Array.isArray(pred.predictions)) {
    throw new Error('predictions.json must look like { "predictions": [ { "task_id": 1, "answer": {} } ] }');
  }

  const scores = [];
  for (const p of pred.predictions) {
    const row = map.get(p.task_id);
    if (!row) {
      scores.push({ task_id: p.task_id, pass: false, detail: "unknown task_id in ground truth" });
      continue;
    }
    scores.push(scoreAgainstExpected(p.task_id, row.expected_answer, p.answer));
  }

  const summary = summarizeScores(scores);
  printSummary(summary, `predictions file: ${predPath}`);
}

function printSummary(summary: ReturnType<typeof summarizeScores>, label: string): void {
  console.log(`\n=== Evaluation (${label}) ===`);
  console.log(`Passed: ${summary.passed}/${summary.total}`);
  for (const t of summary.tasks) {
    console.log(`  task ${t.task_id}: ${t.pass ? "ok" : "FAIL"}${t.detail ? ` — ${t.detail}` : ""}`);
  }
  if (summary.failed > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const gtFlag = argv.indexOf("--ground-truth");
  const gtPath = gtFlag >= 0 && argv[gtFlag + 1] ? resolve(argv[gtFlag + 1]) : DEFAULT_GT;

  const cmd = argv[0] ?? "help";

  try {
    if (cmd === "oracle") {
      await cmdOracle(gtPath);
    } else if (cmd === "score") {
      const pf = argv.indexOf("--predictions");
      if (pf < 0 || !argv[pf + 1]) {
        console.error("Usage: npm run evaluate -- score --predictions path/to/predictions.json");
        process.exitCode = 1;
        return;
      }
      await cmdScore(gtPath, resolve(argv[pf + 1]));
    } else {
      console.log(`
MCP Server evaluation

  npm run evaluate -- oracle
    Check SQL oracle vs ${DEFAULT_GT}

  npm run evaluate -- score --predictions predictions.json
    Score model outputs

  Optional: --ground-truth path/to/ground_truth.json
`);
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  logger.error("evaluate failed", err);
  process.exitCode = 1;
});
