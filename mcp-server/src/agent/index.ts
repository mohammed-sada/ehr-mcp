/**
 * EHR-MCP Evaluation Agent
 * ========================
 * Powered by OpenRouter — one key, any model, free tier available.
 *
 * Setup (one time only):
 *   1. Go to https://openrouter.ai → Sign up (no credit card)
 *   2. Go to Keys → Create Key → copy the key (starts with sk-or-...)
 *   3. Paste into mcp-server/.env:  OPENROUTER_API_KEY=sk-or-...
 *   4. npm install
 *
 * Usage:
 *   npm run eval                              → run all 10 tasks, 1 trial each
 *   npm run eval -- --task 4                  → single task
 *   npm run eval -- --tasks 1,4,18            → run only tasks 1, 4, 18
 *   npm run eval -- --repeats 5               → all tasks, 5 trials each
 *   npm run eval -- --tasks 1,4 --repeats 5   → tasks 1 and 4, 5 trials each
 *   npm run eval -- --repeats 5 --delay 4000  → 4s min between LLM calls (avoids 429s)
 *
 * Rate-limit throttling:
 *   `--delay <ms>` (or env OPENROUTER_REQUEST_DELAY_MS) enforces a minimum
 *   spacing between consecutive LLM calls on the same API key. The agent
 *   and the judge each use their own key, so setting both
 *   OPENROUTER_API_KEY and OPENROUTER_API_KEY_JUDGE doubles your effective
 *   budget. Default 0 = no throttling.
 *
 * Switching models (optional):
 *   Change OPENROUTER_MODEL in .env to any model from https://openrouter.ai/models
 *   Set OPENROUTER_JUDGE_MODEL to a stronger/different model for rigorous judging.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runEvaluation } from "./runner.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CLI args ─────────────────────────────────────────────────────────────────

function getFlag(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function parseIntArg(name: string, value: string | undefined, min = 1): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.floor(n) !== n || n < min) {
    throw new Error(`--${name} must be an integer >= ${min}, got: ${value}`);
  }
  return n;
}

/**
 * Parse a comma-separated list of positive integers (e.g. "1,4,18").
 * Whitespace and trailing commas are tolerated; duplicates are collapsed.
 */
function parseIntListArg(name: string, value: string | undefined): number[] | undefined {
  if (value === undefined) return undefined;
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new Error(`--${name} was empty; expected e.g. --${name} 1,4,18`);
  }
  const ids: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n) || Math.floor(n) !== n || n < 1) {
      throw new Error(`--${name} contains a non-positive-integer value: "${p}"`);
    }
    ids.push(n);
  }
  return Array.from(new Set(ids));
}

// --task and --tasks are aliases; both accept a single id or a CSV list.
const rawTaskArg = getFlag("tasks") ?? getFlag("task");
const taskFilter = parseIntListArg("tasks", rawTaskArg);
const repeats = parseIntArg("repeats", getFlag("repeats")) ?? 1;
// --delay overrides OPENROUTER_REQUEST_DELAY_MS. 0 = disable throttling.
const delayMs = parseIntArg("delay", getFlag("delay"), 0);

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  logger.info("╔══════════════════════════════════════════════════╗");
  logger.info("║     EHR-MCP Agent Evaluation (OpenRouter)        ║");
  logger.info("╚══════════════════════════════════════════════════╝");
  const judgeModelId = env.OPENROUTER_JUDGE_MODEL ?? env.OPENROUTER_MODEL;
  const judgeSameModel = judgeModelId === env.OPENROUTER_MODEL;
  const judgeSameKey = !env.OPENROUTER_API_KEY_JUDGE;
  const judgeSuffix =
    judgeSameModel && judgeSameKey ? " (same as agent)" :
    judgeSameModel ? " (same model, separate API key)" :
    judgeSameKey ? "" : " (separate API key)";
  logger.info(`Agent model : ${env.OPENROUTER_MODEL}`);
  logger.info(`Judge model : ${judgeModelId}${judgeSuffix}`);
  if (taskFilter && taskFilter.length > 0) {
    logger.info(`Tasks       : ${taskFilter.length === 1 ? `#${taskFilter[0]}` : `[${taskFilter.join(", ")}]`} only`);
  } else {
    logger.info(`Tasks       : all 10`);
  }
  logger.info(`Repeats     : ${repeats} trial(s) per task`);
  const effectiveDelay = delayMs ?? env.OPENROUTER_REQUEST_DELAY_MS;
  if (effectiveDelay > 0) {
    logger.info(`Throttle    : ${effectiveDelay}ms between LLM calls per API key`);
  }

  const report = await runEvaluation({ taskFilter, repeats, delayMs });

  // ── Results summary ───────────────────────────────────────────────────────
  logger.info("\n╔══════════════════════════════════════════════════╗");
  logger.info("║                   RESULTS                        ║");
  logger.info("╚══════════════════════════════════════════════════╝");
  logger.info(`Agent model      : ${report.model}`);
  logger.info(`Judge model      : ${report.judge_model}`);
  logger.info(`Tasks / Trials   : ${report.summary.total_tasks} tasks × ${report.repeats} trials = ${report.summary.total_trials} total trials`);
  logger.info(`Mean pass-rate   : ${(report.summary.meanPassRate * 100).toFixed(1)}% (binary ≥0.8 threshold)`);
  logger.info(`Mean score       : ${(report.summary.meanScore * 100).toFixed(1)}% (continuous, partial credit)`);
  logger.info(`Avg tool calls   : ${report.summary.avgToolCalls.toFixed(1)} calls/task`);

  logger.info("\n── Results by task type ───────────────────────────");
  for (const [type, s] of Object.entries(report.summary.byType)) {
    const bar = "█".repeat(Math.round(s.meanPassRate * 20)).padEnd(20, "░");
    logger.info(
      `  ${type.padEnd(10)} ${bar}  tasks=${s.total_tasks} | ` +
      `pass_rate=${(s.meanPassRate * 100).toFixed(0)}% | score=${(s.meanScore * 100).toFixed(0)}%`
    );
  }

  // ── Per-task table ────────────────────────────────────────────────────────
  logger.info("\n── Per-task breakdown ─────────────────────────────");
  const showCI = report.repeats > 1;
  const header = showCI
    ? `${"#".padEnd(4)} ${"Type".padEnd(10)} ${"Pass".padEnd(8)} ${"Score (mean±std)".padEnd(18)} ${"CI95".padEnd(16)} Question`
    : `${"#".padEnd(4)} ${"Type".padEnd(10)} ${"Pass".padEnd(8)} ${"Score".padEnd(8)} Question`;
  logger.info(header);
  logger.info("─".repeat(showCI ? 120 : 90));
  for (const t of report.tasks) {
    const passCount = t.trials.filter((tr) => tr.correct).length;
    const passStr = `${passCount}/${t.n_trials}`;
    const scoreStr = showCI
      ? `${(t.score_mean * 100).toFixed(0)}%±${(t.score_std * 100).toFixed(0)}%`
      : `${(t.score_mean * 100).toFixed(0)}%`;
    const ciStr = showCI
      ? `[${(t.score_ci_low * 100).toFixed(0)},${(t.score_ci_high * 100).toFixed(0)}]`
      : "";
    const q = t.question.slice(0, 55);
    if (showCI) {
      logger.info(
        `${String(t.task_id).padEnd(4)} ${t.type.padEnd(10)} ${passStr.padEnd(8)} ${scoreStr.padEnd(18)} ${ciStr.padEnd(16)} ${q}`
      );
    } else {
      logger.info(
        `${String(t.task_id).padEnd(4)} ${t.type.padEnd(10)} ${passStr.padEnd(8)} ${scoreStr.padEnd(8)} ${q}`
      );
    }
  }

  // ── Failed trials with judge rationale ────────────────────────────────────
  const failures: Array<{ task_id: number; type: string; trial: number; score: number; rationale: string }> = [];
  for (const t of report.tasks) {
    for (const tr of t.trials) {
      if (!tr.correct) {
        failures.push({
          task_id: t.task_id,
          type: t.type,
          trial: tr.trial,
          score: tr.score,
          rationale: tr.error ? `[ERROR] ${tr.error}` : tr.judge_rationale,
        });
      }
    }
  }
  if (failures.length > 0) {
    logger.info("\n── Failed trials (judge rationale) ────────────────");
    for (const f of failures) {
      logger.info(
        `  #${f.task_id} [${f.type}] trial ${f.trial} score=${(f.score * 100).toFixed(0)}%: ${f.rationale}`
      );
    }
  }

  // ── Save JSON report ──────────────────────────────────────────────────────
  const outDir = resolve(__dirname, "output");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = resolve(outDir, `eval_report_${stamp}.json`);
  await writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  logger.info(`\nFull report saved → ${outPath}`);
}

main().catch((err) => {
  logger.error(`\nFatal: ${err.message}`);
  if (err.message.includes("OPENROUTER_API_KEY")) {
    logger.error("→ Get your free key at: https://openrouter.ai");
    logger.error("→ Add OPENROUTER_API_KEY=sk-or-... to mcp-server/.env");
  }
  if (err.message.includes("MCP server") || err.message.includes("Cannot reach")) {
    logger.error("→ Start the MCP server first with: npm run dev");
  }
  process.exit(1);
});
