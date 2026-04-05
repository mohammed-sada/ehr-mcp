# EHR-MCP Agent — Evaluation Client

This folder contains the **AI agent evaluation client** that connects Claude and GPT-4.1
to your MCP server and runs them against the 20 clinical tasks to produce a comparison report.

---

## Architecture: How it all fits together

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR PROJECT                             │
│                                                                 │
│  ┌─────────────────────┐       ┌─────────────────────────────┐  │
│  │   PostgreSQL (MIMIC)│◄──SQL─│   MCP Server (stream.ts)    │  │
│  │   hosp schema       │       │   5 tools exposed via       │  │
│  │   7 tables          │       │   JSON-RPC on /mcp          │  │
│  └─────────────────────┘       └──────────────┬──────────────┘  │
│                                               │ HTTP JSON-RPC   │
│                                ┌──────────────▼──────────────┐  │
│                                │   Agent Runner (runner.ts)  │  │
│                                │                             │  │
│                                │  1. Discovers tools via     │  │
│                                │     tools/list              │  │
│                                │  2. Wraps them as Vercel    │  │
│                                │     AI SDK tools            │  │
│                                │  3. Sends task prompt to    │  │
│                                │     LLM                     │  │
│                                │  4. LLM calls tools in a    │  │
│                                │     ReAct loop (think→act)  │  │
│                                │  5. Scores answer vs        │  │
│                                │     ground_truth.json       │  │
│                                └──────────────┬──────────────┘  │
│                                               │                 │
│                        ┌──────────────────────▼──────────────┐  │
│                        │           index.ts                  │  │
│                        │  Runs Claude + GPT-4.1 in sequence  │  │
│                        │  Prints side-by-side comparison     │  │
│                        │  Saves JSON report to output/       │  │
│                        └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               │           │
                    ┌──────────▼──┐   ┌────▼──────────┐
                    │  Anthropic  │   │    OpenAI     │
                    │  Claude API │   │  GPT-4.1 API  │
                    └─────────────┘   └───────────────┘
```

## What is the Vercel AI SDK?

The **Vercel AI SDK** (`ai` package) is a TypeScript framework that gives LLMs the ability
to use tools in a loop — this is the **ReAct pattern** (Reasoning + Acting):

```
User asks: "What is the latest creatinine for patient 10000032?"
    │
    ▼
LLM thinks: "I need to call latest_lab with subject_id=10000032 and itemid=50912"
    │
    ▼ (tool call)
MCP Server → PostgreSQL → returns { valuenum: 1.2, charttime: "..." }
    │
    ▼
LLM observes result and answers: "The latest creatinine is 1.2 mg/dL from 2180-06-01"
```

`generateText({ tools, maxSteps: 8 })` handles this entire loop automatically.
Each "step" is one think→tool→observe cycle. Complex tasks may need 2-3 steps.

---

## Setup

### 1. Add your API keys to `.env`

```env
ANTHROPIC_API_KEY=sk-ant-...   # Get from console.anthropic.com
OPENAI_API_KEY=sk-...          # Get from platform.openai.com
```

### 2. Install new dependencies

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
# Compare both models on all 20 tasks
npm run eval

# Run only Claude
npm run eval:claude

# Run only GPT-4.1
npm run eval:gpt

# Debug a single task
npx ts-node --esm src/agent/index.ts --model claude --task 4
```

---

## Output

Results are saved to `src/agent/output/eval_report_<timestamp>.json` with this structure:

```json
{
  "claude": {
    "model": "claude-sonnet-4-5-20251001",
    "ran_at": "2026-03-26T...",
    "summary": {
      "total": 20,
      "correct": 17,
      "accuracy": 0.85,
      "avgToolCalls": 1.4,
      "byType": {
        "simple":    { "total": 8,  "correct": 8,  "accuracy": 1.00 },
        "multi":     { "total": 7,  "correct": 6,  "accuracy": 0.86 },
        "reasoning": { "total": 5,  "correct": 3,  "accuracy": 0.60 }
      }
    },
    "tasks": [ ... per-task details ... ]
  },
  "gpt": { ... same structure ... }
}
```

The console also prints a **live side-by-side table**:

```
Task   Type       Claude     GPT-4.1    Question
----------------------------------------------------------------------
1      simple     ✓          ✓          What is the patient's gender...
4      simple     ✓          ✓          What is the latest Lactate...
14     reasoning  ✓          ✗          Compute average Lactate...
17     reasoning  ✗          ✗          Compute trend slope of Lactate...
----------------------------------------------------------------------
TOTAL             85%        80%
```

---

## Files

| File | Purpose |
|---|---|
| `index.ts` | Entry point — parses CLI args, runs models, prints comparison |
| `runner.ts` | Core agent logic — MCP tool discovery, ReAct loop, task execution |
| `scorer.ts` | Answer scoring — exact match, numeric tolerance, Dice coefficient for lists |
| `output/` | Saved evaluation reports (timestamped JSON files) |
