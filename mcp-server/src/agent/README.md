# EHR-MCP Agent — Evaluation Client

This folder contains the **AI agent evaluation client** that connects an LLM
(via OpenRouter) to the MCP server and runs it against the 20 clinical tasks
to produce an accuracy report.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR PROJECT                             │
│                                                                 │
│  ┌─────────────────────┐       ┌─────────────────────────────┐  │
│  │   PostgreSQL (MIMIC) │◄──SQL─│   MCP Server (stream.ts)    │  │
│  │   hosp schema        │       │   7 tools exposed via       │  │
│  │   7 tables           │       │   JSON-RPC on /mcp          │  │
│  └─────────────────────┘       └──────────────┬──────────────┘  │
│                                               │ HTTP JSON-RPC   │
│                                ┌──────────────▼──────────────┐  │
│                                │   Agent Runner (runner.ts)   │  │
│                                │                              │  │
│                                │  1. Discovers tools via      │  │
│                                │     tools/list               │  │
│                                │  2. Wraps them as Vercel     │  │
│                                │     AI SDK tools             │  │
│                                │  3. Sends task prompt to LLM │  │
│                                │  4. LLM calls tools in a     │  │
│                                │     ReAct loop (think→act)   │  │
│                                │  5. Scores answer vs         │  │
│                                │     ground_truth.json        │  │
│                                └──────────────┬──────────────┘  │
│                                               │                 │
│                        ┌──────────────────────▼──────────────┐  │
│                        │           index.ts                   │  │
│                        │  Runs all 20 tasks (or --task N)     │  │
│                        │  Prints per-task + summary results   │  │
│                        │  Saves JSON report to output/        │  │
│                        └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │     OpenRouter      │
                    │  (any model, free   │
                    │   tier available)   │
                    └─────────────────────┘
```

The **Vercel AI SDK** (`ai` package) gives the LLM the ability to use tools
in a loop — the **ReAct pattern** (Reasoning + Acting):

```
User asks: "What is the latest creatinine for patient 10035185?"
    │
    ▼
LLM thinks: "I need to call latest_lab with subject_id=10035185, itemid=50912"
    │
    ▼ (tool call)
MCP Server → PostgreSQL → returns { valuenum: 1.2, charttime: "..." }
    │
    ▼
LLM answers: "The latest creatinine is 1.2 mg/dL from 2180-06-01"
```

`generateText({ tools, maxSteps: 8 })` handles this loop automatically.
Each "step" is one think→tool→observe cycle. Complex tasks may need 2–3 steps.

---

## Setup

### 1. Add your API key to `mcp-server/.env`

```env
OPENROUTER_API_KEY=sk-or-...   # Get from https://openrouter.ai (free tier available)
```

Optionally set the agent model and the judge model:

```env
OPENROUTER_MODEL=openai/gpt-oss-120b:free
# If unset, the same model is used as judge. For publication-grade results,
# set a stronger / different-family judge to mitigate self-preference bias.
OPENROUTER_JUDGE_MODEL=openai/gpt-4o-mini
```

### 2. Install dependencies

```bash
cd mcp-server
npm install
```

### 3. Make sure everything is running

```bash
# Terminal 1: Start the database
docker-compose up -d

# Terminal 2: Start the MCP server
npm run dev

# Terminal 3: Generate fresh ground truth (if not done already)
npm run generate:ground-truth
```

### 4. Run the evaluation

```bash
npm run eval              # all 20 tasks
npm run eval -- --task 4  # single task (good for testing)
```

---

## Scoring: LLM-as-Judge

Every task is scored by an LLM judge rather than regex/substring matching.
The judge receives the question, the SQL ground truth (as JSON), and the
agent's free-text answer, and returns:

```json
{ "score": 0.85, "correct": true, "rationale": "Identifies all 20 admissions with correct hadm_id and timestamps; minor date-formatting difference only." }
```

- `score` is a continuous 0.0–1.0 value (partial credit for lists/sets).
- `correct` is `true` iff `score >= 0.8` (configurable threshold).
- `rationale` is a 1–2 sentence explanation surfaced in the console and saved
  to the JSON report.
- Judge calls use `temperature=0` for reproducibility.

See `judge.ts` for the full judging prompt and parsing logic.

---

## Output

Results are saved to `src/agent/output/eval_report_<timestamp>.json`:

```json
{
  "model": "openai/gpt-oss-120b:free",
  "judge_model": "openai/gpt-4o-mini",
  "ran_at": "2026-04-20T...",
  "mcp_server_url": "http://localhost:3333/mcp",
  "summary": {
    "total": 20,
    "correct": 15,
    "accuracy": 0.75,
    "meanScore": 0.82,
    "avgToolCalls": 1.8,
    "byType": {
      "simple":    { "total": 7, "correct": 7, "accuracy": 1.00, "meanScore": 0.95 },
      "multi":     { "total": 7, "correct": 5, "accuracy": 0.71, "meanScore": 0.78 },
      "reasoning": { "total": 6, "correct": 3, "accuracy": 0.50, "meanScore": 0.68 }
    }
  },
  "tasks": [
    {
      "task_id": 1,
      "score": 1.0,
      "correct": true,
      "judge_rationale": "Answer correctly identifies gender=M and anchor_age=70.",
      "tools_called": ["patient_info"],
      ...
    }
  ]
}
```

The console prints a live table plus a "Failed tasks (judge rationale)"
section listing why each failure was marked wrong.

---

## Files

| File | Purpose |
|---|---|
| `index.ts` | Entry point — parses CLI args, runs evaluation, prints results |
| `runner.ts` | Core agent logic — MCP tool discovery, ReAct loop, task execution |
| `judge.ts` | LLM-as-judge scorer — grades free-text answers vs SQL ground truth |
| `output/` | Saved evaluation reports (timestamped JSON files) |
