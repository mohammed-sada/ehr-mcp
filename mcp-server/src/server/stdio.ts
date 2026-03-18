import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { logger } from "../utils/logger.js";
import * as queries from "../db/queries.js";

function toolTextResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data } as Record<string, unknown>
  };
}

async function main() {
  const server = new McpServer({ name: "mimiciv-mcp-stdio", version: "0.1.0" });

  // Example tool (your requested MVP)
  server.registerTool(
    "greet",
    {
      title: "Greet",
      description: "Greets a user by name",
      inputSchema: z.object({
        name: z.string().min(1).describe("The name of the person to greet")
      })
    },
    async ({ name }) => toolTextResult({ message: `Hello, ${name}!` })
  );

  // Clinical tools (same logic as HTTP server)
  server.registerTool(
    "patient_info",
    {
      title: "Patient Info",
      description: "Get basic patient info plus admissions (by subject_id).",
      inputSchema: z.object({ subject_id: z.number().int().positive() })
    },
    async ({ subject_id }) => toolTextResult(await queries.getPatientInfo(subject_id))
  );

  server.registerTool(
    "latest_lab",
    {
      title: "Latest Lab",
      description: "Get latest lab value for a subject and itemid.",
      inputSchema: z.object({
        subject_id: z.number().int().positive(),
        itemid: z.number().int().positive()
      })
    },
    async ({ subject_id, itemid }) => toolTextResult(await queries.getLatestLab(subject_id, itemid))
  );

  server.registerTool(
    "lab_history",
    {
      title: "Lab History",
      description: "Get lab history for a subject and itemid (limited).",
      inputSchema: z.object({
        subject_id: z.number().int().positive(),
        itemid: z.number().int().positive(),
        limit: z.number().int().positive().max(50_000).optional()
      })
    },
    async ({ subject_id, itemid, limit }) => toolTextResult(await queries.getLabHistory(subject_id, itemid, limit ?? 5000))
  );

  server.registerTool(
    "diagnoses",
    {
      title: "Diagnoses",
      description: "List diagnoses (ICD) for a subject_id (joined to titles).",
      inputSchema: z.object({ subject_id: z.number().int().positive() })
    },
    async ({ subject_id }) => toolTextResult(await queries.getDiagnoses(subject_id))
  );

  server.registerTool(
    "medications",
    {
      title: "Medications",
      description: "List prescriptions for a subject_id (limited).",
      inputSchema: z.object({
        subject_id: z.number().int().positive(),
        limit: z.number().int().positive().max(50_000).optional()
      })
    },
    async ({ subject_id, limit }) => toolTextResult(await queries.getMedications(subject_id, limit ?? 5000))
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Note: Avoid noisy stdout logs for stdio servers in production.
  // Keep a single line so humans know it's running.
  // eslint-disable-next-line no-console
  console.log("MCP Server running (stdio transport)...");

  logger.info("stdio transport connected");
}

main().catch((err) => {
  logger.error("Fatal startup error", err);
  process.exit(1);
});

