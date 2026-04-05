import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Load .env (package root: mcp-server/.env, not mcp-server/src/.env) ────────
const envFile = [path.join(__dirname, "..", ".env"), path.join(__dirname, ".env")].find((p) =>
  fs.existsSync(p)
);
if (!envFile) {
  console.error("ERROR: .env not found (tried mcp-server/.env and mcp-server/src/.env)");
  process.exit(1);
}
const env: Record<string, string> = {};
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const API_KEY = env["OPENROUTER_API_KEY"] ?? "";
const MODEL   = env["OPENROUTER_MODEL"]   ?? "meta-llama/llama-3.3-70b-instruct:free";
const PORT    = Number(env["PORT"] ?? "3333");

if (!API_KEY || API_KEY === "sk-or-...") {
  console.error("ERROR: OPENROUTER_API_KEY not set in .env"); process.exit(1);
}

// ─── Colours ──────────────────────────────────────────────────────────────────
const R="\x1b[0m",B="\x1b[1m",DIM="\x1b[2m",CY="\x1b[36m",GR="\x1b[32m",
      YE="\x1b[33m",BL="\x1b[34m",RE="\x1b[31m",GY="\x1b[90m";

// ─── HTTP GET using Node.js http module ───────────────────────────────────────
async function httpGet(routePath: string, params: Record<string, any> = {}): Promise<string> {
  const qs = Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const fullPath = qs ? `${routePath}?${qs}` : routePath;
  const url = `http://127.0.0.1:${PORT}${fullPath}`;
  const res = await fetch(url);
  return res.text();
}

// ─── Parse plain JSON response (from /api/* direct routes) ──────────────────
function parseSSE(raw: string): any {
  if (!raw || raw.trim() === "") return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [
  { name: "patient_info", route: "/api/patient-info", params: ["subject_id"],          desc: "Get patient demographics and admission history" },
  { name: "latest_lab",   route: "/api/latest-lab",   params: ["subject_id","itemid"], desc: "Get the most recent lab result for a patient" },
  { name: "lab_history",  route: "/api/lab-history",  params: ["subject_id","itemid"], desc: "Get full lab history for a patient" },
  { name: "diagnoses",    route: "/api/diagnoses",     params: ["subject_id"],          desc: "Get all ICD diagnoses for a patient" },
  { name: "medications",  route: "/api/medications",   params: ["subject_id"],          desc: "Get medication and prescription history" },
];

const LAB_ITEMS: Record<string, number> = {
  creatinine: 50912, lactate: 50813, wbc: 51301, hemoglobin: 51222,
  sodium: 50983, potassium: 50971, glucose: 50931, bilirubin: 50885,
};

async function callTool(name: string, args: Record<string, any>): Promise<any> {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  if (name === "medications" && !args.limit) args.limit = 20;
  const raw = await httpGet(tool.route, args);

  // ── DEBUG: print raw response for every tool call ──────────────────────────
  console.log(`\nRAW [${name}]: ${JSON.stringify(raw.slice(0, 600))}`);

  const result = parseSSE(raw);
  return result;
}

// ─── OpenRouter LLM ───────────────────────────────────────────────────────────
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

// ─── Answer a question ────────────────────────────────────────────────────────
async function answerQuestion(question: string, currentPatient: number | null): Promise<string> {
  const toolList = TOOLS.map(t => `  ${t.name}(${t.params.join(", ")}): ${t.desc}`).join("\n");
  const labList  = Object.entries(LAB_ITEMS).map(([k,v]) => `  ${k} = ${v}`).join("\n");
  const patCtx   = currentPatient ? `Current patient subject_id = ${currentPatient}.` : "";

  const plan = await llm(
`You are a tool selector for a hospital EHR system. ${patCtx}

Available tools:
${toolList}

Common lab item IDs (use for itemid parameter):
${labList}

User question: "${question}"

Respond with ONLY a JSON array of tool calls. Examples:
[{"tool":"patient_info","args":{"subject_id":10000032}}]
[{"tool":"latest_lab","args":{"subject_id":10000032,"itemid":50912}}]
[{"tool":"medications","args":{"subject_id":10002428}}]

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
      const data = await callTool(tc.tool, tc.args);
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

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  try { await httpGet("/health"); } catch {
    console.error(`\nERROR: Cannot reach MCP server at 127.0.0.1:${PORT}`);
    console.error("→ Start it first: npm run dev"); process.exit(1);
  }

  console.log(`${GR}Connected!${R} ${DIM}Model: ${MODEL}${R}`);
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
  console.log();

  let currentPatient: number | null = null;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    const pid = currentPatient ? `${CY}[patient ${currentPatient}]${R} ` : "";
    rl.question(`\n${pid}${B}You:${R} `, async (input) => {
      const q = input.trim();
      if (!q) { ask(); return; }
      if (q === "exit" || q === "quit") { console.log(`\n${DIM}Goodbye!${R}`); rl.close(); process.exit(0); }
      if (q === "tools") { TOOLS.forEach(t => console.log(`  ${CY}${t.name}${R}  ${DIM}${t.desc}${R}`)); ask(); return; }
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