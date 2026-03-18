# MCP Server MVP (TypeScript) — MIMIC-IV Demo (PostgreSQL)

This is a **minimal, team-friendly MCP server** written in **TypeScript** that queries our MIMIC-IV (hosp) demo dataset in PostgreSQL and exposes:

- A real **MCP Streamable HTTP** endpoint at `GET/POST /mcp` using `StreamableHTTPServerTransport`
- Simple demo routes that internally invoke MCP tools (also streamable):
  - `GET /patient-info?subject_id=...`
  - `GET /latest-lab?subject_id=...&itemid=...`
  - `GET /lab-history?subject_id=...&itemid=...&limit=...`
  - `GET /diagnoses?subject_id=...`
  - `GET /medications?subject_id=...&limit=...`

## Prereqs

- Node.js 20+ (recommended)
- The PostgreSQL container from the repo root running the demo DB on `localhost:5432`
  - DB: `mimiciv`
  - User/pass: `postgres/postgres`

## Setup

From `mcp-server/`:

```bash
npm install
```

Create an env file (dotfiles may be blocked in some editors; CLI is fine):

- Copy `env.example` to `.env` and edit as needed.

## Run

```bash
npm run dev
```

Server defaults to: `http://localhost:3333`

## Run (stdio mode — simplest)

This avoids HTTP/session/headers entirely and works well with MCP Inspector (stdio).

```bash
npm run stdio
```

## Quick test

Health:

```bash
curl http://localhost:3333/health
```

Patient info:

```bash
curl "http://localhost:3333/patient-info?subject_id=10003400"
```

Latest lab (example itemid: 50813 is Lactate in many MIMIC exports; pick any itemid from `hosp.d_labitems`):

```bash
curl "http://localhost:3333/latest-lab?subject_id=10003400&itemid=50813"
```

### Windows PowerShell examples

The friendly demo routes work without special headers:

```powershell
(Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:3333/patient-info?subject_id=10003400").Content
```

### Calling `/mcp` directly (MCP spec)

If you call `POST /mcp` directly, the MCP Streamable HTTP spec requires:

- `Accept: application/json, text/event-stream`

Example initialize call (Windows PowerShell):

```powershell
$json = '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"0.0.1\"}}}'
$json | curl.exe -s -i -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -X POST --data-binary '@-' "http://127.0.0.1:3333/mcp"
```

## MCP tools

This server registers 5 MCP tools (see `src/server/stream.ts`):

- `patient_info` `{ subject_id }`
- `latest_lab` `{ subject_id, itemid }`
- `lab_history` `{ subject_id, itemid, limit? }`
- `diagnoses` `{ subject_id }`
- `medications` `{ subject_id, limit? }`

In stdio mode (`src/server/stdio.ts`), the server also registers:

- `greet` `{ name }`

## Notes

- All SQL is plain `pg` (no ORM) in `src/db/queries.ts`.
- Tables are expected under schema `hosp` (as created by the Docker init SQL in repo root).

