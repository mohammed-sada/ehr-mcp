import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Load .env ───────────────────────────────────────────────────────────────
const envFile = [path.join(__dirname, "..", ".env"), path.join(__dirname, ".env")].find((p) =>
  fs.existsSync(p)
);
if (!envFile) {
  console.error("ERROR: .env not found (tried mcp-server/.env and mcp-server/src/.env)");
  process.exit(1);
}
const envVars: Record<string, string> = {};
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  envVars[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const API_KEY = envVars["OPENROUTER_API_KEY"] ?? "";
const MODEL   = envVars["OPENROUTER_MODEL"]   ?? "meta-llama/llama-3.3-70b-instruct:free";
const PORT    = Number(envVars["PORT"] ?? "3333");

if (!API_KEY || API_KEY === "sk-or-...") {
  console.error("ERROR: OPENROUTER_API_KEY not set in .env"); process.exit(1);
}

// ─── Colours ─────────────────────────────────────────────────────────────────
const R="\x1b[0m",B="\x1b[1m",DIM="\x1b[2m",CY="\x1b[36m",GR="\x1b[32m",
      YE="\x1b[33m",BL="\x1b[34m",RE="\x1b[31m",GY="\x1b[90m";

// ─── MCP Client (SDK) ───────────────────────────────────────────────────────
let mcpClient: Client;
let mcpTransport: StreamableHTTPClientTransport;

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

let discoveredTools: ToolInfo[] = [];

async function connectMcp(): Promise<void> {
  const url = new URL(`http://127.0.0.1:${PORT}/mcp`);
  mcpTransport = new StreamableHTTPClientTransport(url);
  mcpClient = new Client({ name: "ehr-chat-client", version: "0.1.0" });
  await mcpClient.connect(mcpTransport);

  const { tools } = await mcpClient.listTools();
  discoveredTools = tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema,
  }));
}

async function callMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await mcpClient.callTool({ name, arguments: args });

  if (!("content" in result)) return result;

  const textItem = (result.content as Array<{ type: string; text?: string }>)
    .find((c) => c.type === "text");
  if (!textItem?.text) return null;
  try { return JSON.parse(textItem.text); } catch { return { raw: textItem.text }; }
}

// ─── OpenRouter LLM ─────────────────────────────────────────────────────────
async function llm(prompt: string, temperature = 0): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], temperature }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0,200)}`);
  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content ?? "";
}

// ─── Answer a question ──────────────────────────────────────────────────────
const LAB_ITEMS: Record<string, number> = {
  creatinine: 50912, lactate: 50813, wbc: 51301, hemoglobin: 51222,
  sodium: 50983, potassium: 50971, glucose: 50931, bilirubin: 50885,
  hba1c: 50852,
};

async function answerQuestion(question: string, currentPatient: number | null): Promise<string> {
  const toolList = discoveredTools.map((t) =>
    `  ${t.name}: ${t.description}`
  ).join("\n");
  const labList  = Object.entries(LAB_ITEMS).map(([k,v]) => `  ${k} = ${v}`).join("\n");
  const patCtx   = currentPatient ? `Current patient subject_id = ${currentPatient}.` : "";

  const plan = await llm(
`You are a tool selector for a hospital EHR system. ${patCtx}

Available tools (auto-discovered from MCP server):
${toolList}

Common lab item IDs (use for itemid parameter):
${labList}

User question: "${question}"

Respond with ONLY a JSON array of tool calls. Examples:
[{"tool":"patient_info","args":{"subject_id":10035185}}]
[{"tool":"latest_lab","args":{"subject_id":10035185,"itemid":50912}}]
[{"tool":"add_patient_note","args":{"subject_id":10035185,"body":"DM2 on insulin; review labs."}}]

Rules:
- Use ONLY the exact tool names listed above
- subject_id and itemid must be integers
- For greetings or non-EHR questions return: []
- Return ONLY the JSON array, nothing else`);

  let toolCalls: Array<{ tool: string; args: any }> = [];
  try {
    const match = plan.match(/\[[\s\S]*?\]/);
    if (match) toolCalls = JSON.parse(match[0]);
  } catch {}

  const results: string[] = [];
  for (const tc of toolCalls) {
    process.stdout.write(`\n${GY}  → ${tc.tool}(${JSON.stringify(tc.args)})${R}`);
    try {
      const data = await callMcpTool(tc.tool, tc.args);
      if (data === null || data === undefined) {
        process.stdout.write(`\n${YE}  ⚠ null response${R}`);
        continue;
      }
      const str = JSON.stringify(data, null, 2).slice(0, 3000);
      process.stdout.write(`\n${GY}  ← ${str.slice(0, 100)}...${R}`);
      results.push(`[${tc.tool}]\n${str}`);
    } catch (e: any) {
      process.stdout.write(`\n${RE}  ← error: ${e.message}${R}`);
    }
  }

  if (toolCalls.length > 0 && results.length === 0) {
    return "Sorry, I could not retrieve that data. Please check the MCP server is running and try again.";
  }

  const prompt = results.length > 0
    ? `You are a clinical assistant. Here is real patient data from MIMIC-IV:\n\n${results.join("\n\n")}\n\nAnswer concisely using ONLY this data:\n"${question}"`
    : `You are a clinical EHR assistant. Answer briefly:\n"${question}"`;

  return llm(prompt, 0.1);
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  try { await connectMcp(); } catch {
    console.error(`\nERROR: Cannot connect to MCP server at 127.0.0.1:${PORT}/mcp`);
    console.error("→ Start it first: npm run dev"); process.exit(1);
  }

  console.log(`${GR}Connected via MCP protocol!${R} ${DIM}Model: ${MODEL}${R}`);
  console.log(`${DIM}Discovered ${discoveredTools.length} tools: ${discoveredTools.map((t) => t.name).join(", ")}${R}`);
  console.log();
  console.log(`${B}${CY}╔══════════════════════════════════════════════╗${R}`);
  console.log(`${B}${CY}║     EHR-MCP Clinical Chat (MIMIC-IV)         ║${R}`);
  console.log(`${B}${CY}╚══════════════════════════════════════════════╝${R}`);
  console.log(`${DIM}Commands: patient <id>  |  tools  |  exit${R}`);
  console.log();
  console.log(`${YE}Try:${R}`);
  console.log(`${DIM}  What is the gender and age of patient 10035185?${R}`);
  console.log(`${DIM}  What diagnoses does patient 10009628 have?${R}`);
  console.log(`${DIM}  What medications is patient 10016810 on?${R}`);
  console.log(`${DIM}  Show the latest creatinine for patient 10035185${R}`);
  console.log(`${DIM}  How many distinct lab types does patient 10035185 have?${R}`);
  console.log(`${DIM}  Add a note for patient 10035185: follow-up on A1c${R}`);
  console.log();

  let currentPatient: number | null = null;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    const pid = currentPatient ? `${CY}[patient ${currentPatient}]${R} ` : "";
    rl.question(`\n${pid}${B}You:${R} `, async (input) => {
      const q = input.trim();
      if (!q) { ask(); return; }
      if (q === "exit" || q === "quit") {
        console.log(`\n${DIM}Goodbye!${R}`);
        await mcpTransport.close();
        rl.close();
        process.exit(0);
      }
      if (q === "tools") {
        discoveredTools.forEach((t) => {
          console.log(`  ${CY}${t.name}${R}  ${DIM}${t.description}${R}`);
        });
        ask();
        return;
      }
      const pm = q.match(/^patient\s+(\d+)$/i);
      if (pm) { currentPatient = Number(pm[1]); console.log(`${GR}Patient set to ${currentPatient}${R}`); ask(); return; }

      process.stdout.write(`\n${B}${BL}Thinking...${R}`);
      try {
        const answer = await answerQuestion(q, currentPatient);
        console.log(`\n\n${B}${BL}Assistant:${R} ${answer}`);
      } catch (e: any) {
        console.log(`\n${RE}Error: ${e.message.slice(0,300)}${R}`);
      }
      ask();
    });
  };

  ask();
}

main();
