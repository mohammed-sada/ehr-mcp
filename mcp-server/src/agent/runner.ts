/**
 * Agent Runner
 * ============
 * Single API: OpenRouter (https://openrouter.ai)
 * - One key, hundreds of models
 * - Free models available (no credit card needed)
 * - OpenAI-compatible — we just point @ai-sdk/openai at OpenRouter's base URL
 *
 * How tool selection works:
 *   1. Uses the MCP SDK Client to connect to the MCP server and discover tools
 *   2. Wraps each tool with its real JSON Schema so the LLM sees exact parameters
 *   3. The LLM reads the question + tool descriptions and AUTONOMOUSLY picks which tool(s) to call
 *   4. tool.execute() → client.callTool() → MCP server → PostgreSQL → data
 *   5. The LLM reads the data and answers → scored by LLM-as-judge against ground_truth.json
 *
 * Repeated runs: each task is executed `repeats` times to measure stability.
 * We report pass_rate, mean/std of continuous score, and a bootstrap 95% CI.
 */

import { generateText, tool, jsonSchema } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { tasks } from "../evaluation/tasks.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/index.js";
import type { GroundTruthRow } from "../evaluation/types.js";
import { judgeAnswer } from "./judge.js";
import { bootstrapMeanCI, mean, sampleStd } from "./stats.js";
import { throttleLlmCall } from "./throttle.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Types ────────────────────────────────────────────────────────────────────

/** One execution of a task (LLM answer + judge verdict). */
export interface TrialResult {
  trial: number;                 // 1-indexed trial number
  llm_answer: string;
  correct: boolean;
  score: number;
  judge_rationale: string;
  tools_called: string[];
  tool_call_count: number;
  duration_ms: number;
  error?: string;
}

/** Aggregate result for one task across all trials. */
export interface TaskResult {
  task_id: number;
  type: string;
  question: string;
  subject_id: number;
  expected_answer: unknown;

  n_trials: number;
  pass_rate: number;              // fraction of trials with correct=true
  score_mean: number;
  score_std: number;              // sample std, 0 if n<2
  score_ci_low: number;           // bootstrap 95% CI
  score_ci_high: number;
  avg_duration_ms: number;
  avg_tool_calls: number;

  /** Convenience alias for score_mean (back-compat for downstream viewers). */
  score: number;
  /** Convenience alias — true if pass_rate >= 0.5 (majority correct). */
  correct: boolean;

  trials: TrialResult[];
}

export interface EvalReport {
  model: string;
  judge_model: string;
  ran_at: string;
  mcp_server_url: string;
  repeats: number;
  tasks: TaskResult[];
  summary: {
    total_tasks: number;
    total_trials: number;
    /** Mean pass-rate across tasks (unweighted). */
    meanPassRate: number;
    /** Mean continuous score across tasks. */
    meanScore: number;
    avgToolCalls: number;
    byType: Record<string, {
      total_tasks: number;
      meanPassRate: number;
      meanScore: number;
    }>;
  };
}

// ─── MCP Client ───────────────────────────────────────────────────────────────

interface McpConnection {
  client: Client;
  transport: StreamableHTTPClientTransport;
  tools: Record<string, ReturnType<typeof tool>>;
}

async function connectMcpAndDiscoverTools(mcpUrl: string): Promise<McpConnection> {
  const url = new URL(mcpUrl);
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client({ name: "ehr-eval-agent", version: "0.1.0" });

  await client.connect(transport);

  const { tools: mcpTools } = await client.listTools();
  if (mcpTools.length === 0) throw new Error("MCP server returned 0 tools.");

  logger.info(`Discovered ${mcpTools.length} tools: ${mcpTools.map((t) => t.name).join(", ")}`);

  const wrapped: Record<string, unknown> = {};

  for (const t of mcpTools) {
    const name = t.name;
    wrapped[name] = tool({
      description: t.description ?? name,
      parameters: jsonSchema(t.inputSchema as any),
      execute: async (args) => {
        const result = await client.callTool({ name, arguments: args as Record<string, unknown> });

        if (!("content" in result)) return result;

        const textItem = (result.content as Array<{ type: string; text?: string }>)
          .find((c) => c.type === "text");
        if (!textItem?.text) return { error: "No text content in response" };
        try { return JSON.parse(textItem.text); } catch { return { raw: textItem.text }; }
      },
    });
  }

  return {
    client,
    transport,
    tools: wrapped as Record<string, ReturnType<typeof tool>>,
  };
}

// ─── Single Trial Execution ──────────────────────────────────────────────────

interface TrialContext {
  model: any;
  judgeModel: any;
  mcpTools: Record<string, ReturnType<typeof tool>>;
  agentKey: string;
  judgeKey: string;
  delayMs: number;
}

async function runSingleTrial(
  trialNum: number,
  task: (typeof tasks)[0],
  ctx: TrialContext,
  groundTruth: GroundTruthRow,
): Promise<TrialResult> {
  const start = Date.now();
  const toolsCalled: string[] = [];

  const systemPrompt = `You are a clinical data assistant connected to a hospital EHR database.
You have access to tools that query real patient data. Always follow this process:
1. Read the patient question carefully
2. Call the appropriate tool(s) to fetch the actual data
3. Analyse the data returned by the tools
4. Give a clear, direct answer based ONLY on what the tools returned
Never guess or fabricate clinical values — always use the tools.`;

  const userPrompt = `Patient subject_id: ${task.subject_id}
${task.params ? `Additional context: ${JSON.stringify(task.params)}` : ""}

Question: ${task.question}

Please use the available tools to retrieve the data and answer the question directly.`;

  try {
    // Throttle the initial agent call (first LLM step).
    await throttleLlmCall(ctx.agentKey, ctx.delayMs);

    const result = await generateText({
      model: ctx.model,
      system: systemPrompt,
      prompt: userPrompt,
      tools: ctx.mcpTools,
      maxSteps: 8,
      // onStepFinish runs after each step (LLM response + any tool execs).
      // Awaiting here blocks the SDK's internal loop before it fires the
      // next LLM step, spacing out multi-step calls on the agent's key.
      onStepFinish: async (step) => {
        for (const tc of step.toolCalls ?? []) {
          toolsCalled.push(tc.toolName);
          logger.info(`    → [tool] ${tc.toolName}(${JSON.stringify(tc.args).slice(0, 120)})`);
        }
        if (step.text) {
          logger.info(`    ← [answer] ${step.text.slice(0, 160)}`);
        }
        // Only throttle if another step is coming (i.e. we're not done).
        if (step.finishReason !== "stop" && step.finishReason !== "error") {
          await throttleLlmCall(ctx.agentKey, ctx.delayMs);
        }
      },
    });

    const verdict = await judgeAnswer({
      question: task.question,
      expectedAnswer: groundTruth.expected_answer,
      llmAnswer: result.text,
      model: ctx.judgeModel,
      apiKey: ctx.judgeKey,
      delayMs: ctx.delayMs,
    });

    return {
      trial: trialNum,
      llm_answer: result.text,
      correct: verdict.correct,
      score: verdict.score,
      judge_rationale: verdict.rationale,
      tools_called: toolsCalled,
      tool_call_count: toolsCalled.length,
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`    ✗ Trial ${trialNum} failed: ${errMsg.slice(0, 200)}`);
    return {
      trial: trialNum,
      llm_answer: "",
      correct: false,
      score: 0,
      judge_rationale: "Trial execution failed before judging.",
      tools_called: toolsCalled,
      tool_call_count: toolsCalled.length,
      duration_ms: Date.now() - start,
      error: errMsg,
    };
  }
}

// ─── Task With Repeats ───────────────────────────────────────────────────────

async function runTaskRepeats(
  task: (typeof tasks)[0],
  ctx: TrialContext,
  groundTruth: GroundTruthRow,
  repeats: number,
): Promise<TaskResult> {
  const trials: TrialResult[] = [];

  for (let i = 1; i <= repeats; i++) {
    logger.info(`  ── Trial ${i}/${repeats} ──`);
    // eslint-disable-next-line no-await-in-loop
    const trial = await runSingleTrial(i, task, ctx, groundTruth);
    trials.push(trial);
    const mark = trial.correct ? "✓" : "✗";
    logger.info(
      `    ${mark} Score ${(trial.score * 100).toFixed(0)}% | ` +
      `Tools [${trial.tools_called.join("→") || "none"}] | ${trial.duration_ms}ms`
    );
    if (trial.judge_rationale && !trial.correct) {
      logger.info(`    ⎿ Judge: ${trial.judge_rationale.slice(0, 200)}`);
    }
  }

  const scores = trials.map((t) => t.score);
  const score_mean = mean(scores);
  const score_std = sampleStd(scores);
  const [score_ci_low, score_ci_high] = bootstrapMeanCI(scores);
  const pass_rate = trials.filter((t) => t.correct).length / (trials.length || 1);
  const avg_duration_ms = mean(trials.map((t) => t.duration_ms));
  const avg_tool_calls = mean(trials.map((t) => t.tool_call_count));

  return {
    task_id: task.id,
    type: task.type,
    question: task.question,
    subject_id: task.subject_id,
    expected_answer: groundTruth.expected_answer,
    n_trials: trials.length,
    pass_rate,
    score_mean,
    score_std,
    score_ci_low,
    score_ci_high,
    avg_duration_ms,
    avg_tool_calls,
    score: score_mean,
    correct: pass_rate >= 0.5,
    trials,
  };
}

// ─── Main Evaluation Orchestrator ─────────────────────────────────────────────

export interface RunEvaluationOptions {
  /** Restrict to a specific list of task IDs. Undefined = run all tasks. */
  taskFilter?: number[];
  repeats?: number;
  /**
   * Minimum ms between consecutive LLM calls on the same API key.
   * Overrides OPENROUTER_REQUEST_DELAY_MS from env. 0 = no throttling.
   */
  delayMs?: number;
}

export async function runEvaluation(opts: RunEvaluationOptions = {}): Promise<EvalReport> {
  const repeats = Math.max(1, Math.floor(opts.repeats ?? 1));

  if (!env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is not set in your .env file.\n" +
      "→ Sign up at https://openrouter.ai (no credit card needed)\n" +
      "→ Go to Keys → Create Key\n" +
      "→ Add to mcp-server/.env:  OPENROUTER_API_KEY=sk-or-..."
    );
  }

  const mcpUrl = `http://localhost:${env.PORT}/mcp`;
  const modelId = env.OPENROUTER_MODEL;
  const judgeModelId = env.OPENROUTER_JUDGE_MODEL ?? modelId;
  const judgeKey = env.OPENROUTER_API_KEY_JUDGE ?? env.OPENROUTER_API_KEY;
  const separateJudgeKey = judgeKey !== env.OPENROUTER_API_KEY;

  const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
  const agentClient = createOpenAI({
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
  });
  const judgeClient = separateJudgeKey
    ? createOpenAI({ apiKey: judgeKey, baseURL: OPENROUTER_BASE_URL })
    : agentClient;

  const model = agentClient(modelId);
  // Re-use the same model instance only if BOTH the key and the model id match.
  const judgeModel =
    !separateJudgeKey && judgeModelId === modelId
      ? model
      : judgeClient(judgeModelId);

  const delayMs = Math.max(0, Math.floor(opts.delayMs ?? env.OPENROUTER_REQUEST_DELAY_MS));

  const sameModelStr = judgeModelId === modelId ? " (same model as agent)" : "";
  const keyStr = separateJudgeKey ? ", separate API key" : "";
  logger.info(`Agent model : ${modelId}`);
  logger.info(`Judge model : ${judgeModelId}${sameModelStr}${keyStr}`);
  logger.info(`Repeats     : ${repeats} trial(s) per task`);
  logger.info(
    `Throttle    : ${delayMs > 0 ? `${delayMs}ms between calls (per key)` : "disabled"}`
  );
  logger.info(`Via         : OpenRouter (https://openrouter.ai)`);
  logger.info(`Server      : ${mcpUrl}`);

  const gtPath = resolve(__dirname, "../evaluation/output/ground_truth.json");
  const groundTruth: GroundTruthRow[] = JSON.parse(await readFile(gtPath, "utf8"));

  const mcp = await connectMcpAndDiscoverTools(mcpUrl);

  let tasksToRun = tasks;
  if (opts.taskFilter && opts.taskFilter.length > 0) {
    const filterSet = new Set(opts.taskFilter);
    tasksToRun = tasks.filter((t) => filterSet.has(t.id));

    const foundIds = new Set(tasksToRun.map((t) => t.id));
    const missing = opts.taskFilter.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      logger.warn(`Ignoring unknown task id(s): ${missing.join(", ")}`);
    }
    if (tasksToRun.length === 0) {
      throw new Error(
        `No matching tasks. Requested: [${opts.taskFilter.join(", ")}]. ` +
        `Available: [${tasks.map((t) => t.id).join(", ")}]`
      );
    }
  }

  const taskResults: TaskResult[] = [];

  const trialCtx: TrialContext = {
    model,
    judgeModel,
    mcpTools: mcp.tools,
    agentKey: env.OPENROUTER_API_KEY,
    judgeKey,
    delayMs,
  };

  for (const task of tasksToRun) {
    const gt = groundTruth.find((g) => g.task_id === task.id);
    if (!gt) {
      logger.warn(`No ground truth for task ${task.id} — skipping`);
      continue;
    }

    logger.info(`\n── Task ${task.id} [${task.type.toUpperCase()}] ──`);
    logger.info(`   ${task.question}`);

    // eslint-disable-next-line no-await-in-loop
    const result = await runTaskRepeats(task, trialCtx, gt, repeats);
    taskResults.push(result);

    const ciStr = repeats > 1
      ? ` CI95=[${(result.score_ci_low * 100).toFixed(0)}%,${(result.score_ci_high * 100).toFixed(0)}%]`
      : "";
    logger.info(
      `  Task ${task.id} result: pass_rate=${(result.pass_rate * 100).toFixed(0)}% ` +
      `(${result.trials.filter(t => t.correct).length}/${repeats}), ` +
      `score=${(result.score_mean * 100).toFixed(0)}%±${(result.score_std * 100).toFixed(0)}%${ciStr}, ` +
      `avg_tools=${result.avg_tool_calls.toFixed(1)}`
    );
  }

  await mcp.transport.close();

  // ── Build summary ──────────────────────────────────────────────────────────
  const total_tasks = taskResults.length;
  const total_trials = taskResults.reduce((s, r) => s + r.n_trials, 0);
  const meanPassRate = mean(taskResults.map((r) => r.pass_rate));
  const meanScore = mean(taskResults.map((r) => r.score_mean));
  const avgToolCalls = mean(taskResults.map((r) => r.avg_tool_calls));

  const typeMap: Record<string, { passRates: number[]; scores: number[] }> = {};
  for (const r of taskResults) {
    if (!typeMap[r.type]) typeMap[r.type] = { passRates: [], scores: [] };
    typeMap[r.type].passRates.push(r.pass_rate);
    typeMap[r.type].scores.push(r.score_mean);
  }

  const byType: EvalReport["summary"]["byType"] = {};
  for (const [type, buckets] of Object.entries(typeMap)) {
    byType[type] = {
      total_tasks: buckets.passRates.length,
      meanPassRate: mean(buckets.passRates),
      meanScore: mean(buckets.scores),
    };
  }

  return {
    model: modelId,
    judge_model: judgeModelId,
    ran_at: new Date().toISOString(),
    mcp_server_url: mcpUrl,
    repeats,
    tasks: taskResults,
    summary: {
      total_tasks,
      total_trials,
      meanPassRate,
      meanScore,
      avgToolCalls,
      byType,
    },
  };
}
