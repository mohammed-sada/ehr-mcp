import http from "node:http";
import { z } from "zod";
import { env } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { healthcheck } from "../db/index.js";
import * as queries from "../db/queries.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

function toolTextResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data } as Record<string, unknown>
  };
}

function registerTools(server: McpServer) {
  server.registerTool(
    "patient_info",
    {
      title: "Patient Info",
      description: "Get basic patient info plus admissions (by subject_id).",
      inputSchema: z.object({
        subject_id: z.number().int().positive()
      })
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
      inputSchema: z.object({
        subject_id: z.number().int().positive()
      })
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
}

function mapRouteToTool(pathname: string): { tool: string; argMap: (sp: URLSearchParams) => Record<string, unknown> } | null {
  const subjectId = (sp: URLSearchParams) => Number(sp.get("subject_id"));
  const itemid = (sp: URLSearchParams) => Number(sp.get("itemid"));
  const limit = (sp: URLSearchParams) => (sp.get("limit") ? Number(sp.get("limit")) : undefined);

  switch (pathname) {
    case "/patient-info":
      return { tool: "patient_info", argMap: (sp) => ({ subject_id: subjectId(sp) }) };
    case "/latest-lab":
      return { tool: "latest_lab", argMap: (sp) => ({ subject_id: subjectId(sp), itemid: itemid(sp) }) };
    case "/lab-history":
      return { tool: "lab_history", argMap: (sp) => ({ subject_id: subjectId(sp), itemid: itemid(sp), limit: limit(sp) }) };
    case "/diagnoses":
      return { tool: "diagnoses", argMap: (sp) => ({ subject_id: subjectId(sp) }) };
    case "/medications":
      return { tool: "medications", argMap: (sp) => ({ subject_id: subjectId(sp), limit: limit(sp) }) };
    default:
      return null;
  }
}

async function main() {
  const mcp = new McpServer({ name: "mimiciv-mcp-mvp", version: "0.1.0" });
  registerTools(mcp);

  // Stateless mode keeps things simple (no session headers required).
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);

  let idSeq = 1;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // Basic CORS (useful for browser-based testing)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      if (url.pathname === "/health" && req.method === "GET") {
        const hc = await healthcheck();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(hc));
        return;
      }

      // Native MCP endpoint (Streamable HTTP transport spec)
      if (url.pathname === "/mcp") {
        // Let the transport read/parse the request body itself.
        // Pre-reading the stream here breaks the Node->Web conversion done by @hono/node-server.
        await transport.handleRequest(req as any, res);
        return;
      }

      // Friendly REST-like endpoints that internally call MCP tools via the same transport.
      // This keeps the response fully MCP-streamable while offering simple URLs for demos.
      const mapping = mapRouteToTool(url.pathname);
      if (mapping && req.method === "GET") {
        const body = {
          jsonrpc: "2.0",
          id: idSeq++,
          method: "tools/call",
          params: {
            name: mapping.tool,
            arguments: mapping.argMap(url.searchParams)
          }
        };

        // Delegate to the real MCP endpoint using loopback fetch.
        // This ensures StreamableHTTPServerTransport sees a real IncomingMessage and
        // keeps these friendly routes fully MCP-streamable.
        const upstream = await fetch(`http://127.0.0.1:${env.PORT}/mcp`, {
          method: "POST",
          headers: {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });

        res.statusCode = upstream.status;
        upstream.headers.forEach((value, key) => {
          // Avoid forwarding hop-by-hop headers that Node manages.
          if (key.toLowerCase() === "connection") return;
          res.setHeader(key, value);
        });

        if (!upstream.body) {
          res.end();
          return;
        }

        // Stream body through to the client.
        const { Readable } = await import("node:stream");
        Readable.fromWeb(upstream.body as any).pipe(res);
        return;
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: { message: "Not found" } }));
    } catch (err) {
      logger.error("Request error", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify({ ok: false, error: { message: "Internal server error" } }));
    }
  });

  server.listen(env.PORT, () => {
    logger.info(`MCP server listening on http://localhost:${env.PORT}`);
    logger.info("MCP endpoint: /mcp");
    logger.info("Demo routes: /patient-info /latest-lab /lab-history /diagnoses /medications");
  });
}

main().catch((err) => {
  logger.error("Fatal startup error", err);
  process.exit(1);
});

