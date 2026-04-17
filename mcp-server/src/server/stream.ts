import http from "node:http";
import { env } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { healthcheck } from "../db/index.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerClinicalTools } from "./clinicalTools.js";

function createMcpServer(): McpServer {
  const mcp = new McpServer({ name: "mimiciv-mcp-mvp", version: "0.1.0" });
  registerClinicalTools(mcp);
  return mcp;
}

async function main() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id");
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

      if (url.pathname === "/mcp") {
        const mcp = createMcpServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => {
          transport.close().catch(() => {});
          mcp.close().catch(() => {});
        });
        await mcp.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Not found. Use POST /mcp for the MCP protocol endpoint." },
        id: null,
      }));
    } catch (err) {
      logger.error("Request error", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      }));
    }
  });

  server.listen(env.PORT, () => {
    logger.info(`MCP server listening on http://localhost:${env.PORT}`);
    logger.info(`MCP endpoint : POST http://localhost:${env.PORT}/mcp`);
    logger.info(`Health check : GET  http://localhost:${env.PORT}/health`);
  });
}

main().catch((err) => {
  logger.error("Fatal startup error", err);
  process.exit(1);
});
