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
 *   npm run eval              → run all 35 tasks
 *   npm run eval -- --task 4  → run a single task (good for testing)
 *
 * Switching models (optional):
 *   Change OPENROUTER_MODEL in .env to any model from https://openrouter.ai/models
 *   Free models (no credits needed) end with :free, e.g.:
 *     meta-llama/llama-3.3-70b-instruct:free
 *     qwen/qwen3.6-plus-preview:free
 *     mistralai/mistral-small-3.1-24b-instruct:free
 */

import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runEvaluation } from "./runner.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const taskArg = args.find((_, i) => args[i - 1] === "--task");
const taskFilter = taskArg ? Number(taskArg) : undefined;

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  logger.info("╔══════════════════════════════════════════════════╗");
  logger.info("║     EHR-MCP Agent Evaluation (OpenRouter)        ║");
  logger.info("╚══════════════════════════════════════════════════╝");
  logger.info(`Model : ${env.OPENROUTER_MODEL}`);
  if (taskFilter) {
    logger.info(`Task  : #${taskFilter} only`);
  } else {
    logger.info(`Tasks : all 35`);
  }

  const report = await runEvaluation(taskFilter);

  // ── Results summary ───────────────────────────────────────────────────────
  logger.info("\n╔══════════════════════════════════════════════════╗");
  logger.info("║                   RESULTS                       ║");
  logger.info("╚══════════════════════════════════════════════════╝");
  logger.info(`Model    : ${report.model}`);
  logger.info(`Correct  : ${report.summary.correct}/${report.summary.total}`);
  logger.info(`Accuracy : ${(report.summary.accuracy * 100).toFixed(1)}%`);
  logger.info(`Avg tools: ${report.summary.avgToolCalls.toFixed(1)} calls/task`);

  logger.info("\n── Accuracy by task type ──────────────────────────");
  for (const [type, s] of Object.entries(report.summary.byType)) {
    const pct = (s as any).accuracy;
    const bar = "█".repeat(Math.round(pct * 20)).padEnd(20, "░");
    logger.info(
      `  ${type.padEnd(10)} ${bar}  ${(s as any).correct}/${(s as any).total} (${(pct * 100).toFixed(0)}%)`
    );
  }

  // ── Per-task table ────────────────────────────────────────────────────────
  logger.info("\n── Per-task breakdown ─────────────────────────────");
  logger.info(`${"#".padEnd(4)} ${"Type".padEnd(10)} ${"Result".padEnd(8)} ${"Tools used".padEnd(35)} Question`);
  logger.info("─".repeat(105));
  for (const t of report.tasks) {
    const mark = t.correct ? "✓" : "✗";
    const result = `${mark} ${(t.score * 100).toFixed(0)}%`;
    const toolStr = (t.tools_called.join("→") || "none").slice(0, 34).padEnd(35);
    logger.info(
      `${String(t.task_id).padEnd(4)} ${t.type.padEnd(10)} ${result.padEnd(8)} ${toolStr} ${t.question.slice(0, 48)}`
    );
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
