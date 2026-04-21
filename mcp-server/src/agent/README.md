# EHR-MCP Agent — Evaluation Client

This folder contains the **AI agent evaluation client** that connects an LLM
(via OpenRouter) to the MCP server and runs it against the 10 clinical tasks,
optionally with repeated trials per task for stability measurement.

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
│                        │  Runs 10 tasks × N trials            │  │
│                        │  (--task, --repeats flags)           │  │
│                        │  Prints pass-rate, mean±std, CI95    │  │
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

Optionally set the agent model, judge model, and a separate judge API key:

```env
OPENROUTER_MODEL=openai/gpt-oss-120b:free

# If unset, the same model is used as judge. For publication-grade results,
# set a stronger / different-family judge to mitigate self-preference bias.
OPENROUTER_JUDGE_MODEL=openai/gpt-4o-mini

# Optional: use a second OpenRouter account/key for the judge. Useful to
# double effective rate-limit headroom when agent and judge share a model
# (e.g. both on the free tier). Falls back to OPENROUTER_API_KEY if unset.
OPENROUTER_API_KEY_JUDGE=sk-or-...
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
npm run eval                              # all 10 tasks, 1 trial each
npm run eval -- --task 4                  # single task (quick test)
npm run eval -- --tasks 1,4,18            # specific subset
npm run eval -- --repeats 5               # all 10 tasks, 5 trials each (stability)
npm run eval -- --tasks 1,4 --repeats 5   # subset + repeats
npm run eval -- --repeats 5 --delay 4000  # 4s spacing between LLM calls (avoids 429s)
```

`--task` and `--tasks` are aliases — both accept a single id or a CSV list
(`--task 1,4,18` also works). Unknown ids are warned and skipped.

### Rate-limit throttling

Each trial fires up to ~10 LLM calls (1 initial agent call + its multi-step
tool loop + 1 judge call). On OpenRouter's free tier (~20 req/min) a run
like `--repeats 5` can burst enough to trigger 429 errors.

`--delay <ms>` (or env `OPENROUTER_REQUEST_DELAY_MS`) enforces a minimum
spacing between consecutive LLM calls **per API key**. Calls on different
keys are tracked independently, so setting both `OPENROUTER_API_KEY` and
`OPENROUTER_API_KEY_JUDGE` doubles your effective budget — the throttler
treats each as its own bucket.

Default is `0` (no throttling). For a free-tier run, `--delay 3000` to
`--delay 4000` is typically safe.

Each task is executed `--repeats` times. We report:
- **pass_rate** — fraction of trials with `correct=true` (judge score ≥ 0.8)
- **score_mean ± score_std** — continuous judge score across trials
- **CI95** — bootstrap 95% confidence interval of the mean (1000 resamples, seeded)

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
  "ran_at": "2026-04-21T...",
  "mcp_server_url": "http://localhost:3333/mcp",
  "repeats": 5,
  "summary": {
    "total_tasks": 10,
    "total_trials": 50,
    "meanPassRate": 0.72,
    "meanScore": 0.81,
    "avgToolCalls": 2.3,
    "byType": {
      "simple":    { "total_tasks": 3, "meanPassRate": 1.00, "meanScore": 0.97 },
      "multi":     { "total_tasks": 4, "meanPassRate": 0.70, "meanScore": 0.78 },
      "reasoning": { "total_tasks": 3, "meanPassRate": 0.47, "meanScore": 0.68 }
    }
  },
  "tasks": [
    {
      "task_id": 1,
      "type": "simple",
      "n_trials": 5,
      "pass_rate": 1.0,
      "score_mean": 0.98,
      "score_std": 0.045,
      "score_ci_low": 0.92,
      "score_ci_high": 1.00,
      "avg_duration_ms": 5100,
      "avg_tool_calls": 1.0,
      "trials": [
        {
          "trial": 1,
          "llm_answer": "The patient is male and his anchor age is 70 years.",
          "correct": true,
          "score": 1.0,
          "judge_rationale": "Correctly identifies gender=M and anchor_age=70.",
          "tools_called": ["patient_info"],
          "tool_call_count": 1,
          "duration_ms": 5012
        }
      ]
    }
  ]
}
```

The console prints:
- a per-task summary line (`pass_rate=N/M, score=mean±std CI95=[lo,hi]`)
- a results-by-type table
- a "Failed trials (judge rationale)" section listing every trial that did
  not pass, with the judge's 1–2 sentence reasoning — useful for debugging.

---

## Files

| File | Purpose |
|---|---|
| `index.ts` | Entry point — parses CLI args (`--task`, `--repeats`), runs evaluation, prints results |
| `runner.ts` | Core agent logic — MCP tool discovery, ReAct loop, trials × tasks orchestration |
| `judge.ts` | LLM-as-judge scorer — grades free-text answers vs SQL ground truth |
| `stats.ts` | Summary statistics: mean, sample std, seeded bootstrap 95% CI |
| `output/` | Saved evaluation reports (timestamped JSON files) |
