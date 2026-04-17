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
 *   5. The LLM reads the data and answers → scored against ground_truth.json
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
import { scoreAnswer } from "./scorer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskResult {
  task_id: number;
  type: string;
  question: string;
  subject_id: number;
  llm_answer: string;
  expected_answer: unknown;
  correct: boolean;
  score: number;
  tools_called: string[];
  tool_call_count: number;
  error?: string;
  duration_ms: number;
}

export interface EvalReport {
  model: string;
  ran_at: string;
  mcp_server_url: string;
  tasks: TaskResult[];
  summary: {
    total: number;
    correct: number;
    accuracy: number;
    avgToolCalls: number;
    byType: Record<string, { total: number; correct: number; accuracy: number }>;
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

// ─── Single Task Execution ────────────────────────────────────────────────────

async function runTask(
  task: (typeof tasks)[0],
  mcpTools: Record<string, ReturnType<typeof tool>>,
  model: any,
  groundTruth: GroundTruthRow
): Promise<TaskResult> {
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
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      tools: mcpTools,
      maxSteps: 8,
      onStepFinish: (step) => {
        for (const tc of step.toolCalls ?? []) {
          toolsCalled.push(tc.toolName);
          logger.info(`  → [tool] ${tc.toolName}(${JSON.stringify(tc.args).slice(0, 120)})`);
        }
        if (step.text) {
          logger.info(`  ← [answer] ${step.text.slice(0, 200)}`);
        }
      },
    });

    const { correct, score } = scoreAnswer(
      result.text,
      groundTruth.expected_answer,
      task.type
    );

    return {
      task_id: task.id,
      type: task.type,
      question: task.question,
      subject_id: task.subject_id,
      llm_answer: result.text,
      expected_answer: groundTruth.expected_answer,
      correct,
      score,
      tools_called: toolsCalled,
      tool_call_count: toolsCalled.length,
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`  ✗ Task ${task.id} failed: ${errMsg}`);
    return {
      task_id: task.id,
      type: task.type,
      question: task.question,
      subject_id: task.subject_id,
      llm_answer: "",
      expected_answer: groundTruth.expected_answer,
      correct: false,
      score: 0,
      tools_called: toolsCalled,
      tool_call_count: toolsCalled.length,
      error: errMsg,
      duration_ms: Date.now() - start,
    };
  }
}

// ─── Main Evaluation Orchestrator ─────────────────────────────────────────────

export async function runEvaluation(taskFilter?: number): Promise<EvalReport> {
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

  const openrouter = createOpenAI({
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });
  const model = openrouter(modelId);

  logger.info(`Model  : ${modelId}`);
  logger.info(`Via    : OpenRouter (https://openrouter.ai)`);
  logger.info(`Server : ${mcpUrl}`);

  const gtPath = resolve(__dirname, "../evaluation/output/ground_truth.json");
  const groundTruth: GroundTruthRow[] = JSON.parse(await readFile(gtPath, "utf8"));

  const mcp = await connectMcpAndDiscoverTools(mcpUrl);

  const tasksToRun = taskFilter
    ? tasks.filter((t) => t.id === taskFilter)
    : tasks;

  const taskResults: TaskResult[] = [];

  for (const task of tasksToRun) {
    const gt = groundTruth.find((g) => g.task_id === task.id);
    if (!gt) {
      logger.warn(`No ground truth for task ${task.id} — skipping`);
      continue;
    }

    logger.info(`\n── Task ${task.id}/${tasksToRun.length} [${task.type.toUpperCase()}] ──`);
    logger.info(`   ${task.question}`);

    const result = await runTask(task, mcp.tools, model, gt);
    taskResults.push(result);

    const mark = result.correct ? "✓" : "✗";
    logger.info(
      `  ${mark} Score: ${(result.score * 100).toFixed(0)}% | ` +
      `Tools: [${result.tools_called.join(" → ") || "none"}] | ` +
      `${result.duration_ms}ms`
    );
  }

  await mcp.transport.close();

  // ── Build summary ──────────────────────────────────────────────────────────
  const total = taskResults.length;
  const correct = taskResults.filter((r) => r.correct).length;
  const avgToolCalls =
    taskResults.reduce((s, r) => s + r.tool_call_count, 0) / (total || 1);

  const typeMap: Record<string, { total: number; correct: number }> = {};
  for (const r of taskResults) {
    if (!typeMap[r.type]) typeMap[r.type] = { total: 0, correct: 0 };
    typeMap[r.type].total++;
    if (r.correct) typeMap[r.type].correct++;
  }

  const byType: Record<string, { total: number; correct: number; accuracy: number }> = {};
  for (const [type, counts] of Object.entries(typeMap)) {
    byType[type] = { ...counts, accuracy: counts.correct / counts.total };
  }

  return {
    model: modelId,
    ran_at: new Date().toISOString(),
    mcp_server_url: mcpUrl,
    tasks: taskResults,
    summary: { total, correct, accuracy: correct / (total || 1), avgToolCalls, byType },
  };
}
