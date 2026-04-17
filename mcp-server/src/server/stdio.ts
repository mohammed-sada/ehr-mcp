import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { logger } from "../utils/logger.js";
import { registerClinicalTools, toolTextResult } from "./clinicalTools.js";

async function main() {
  const server = new McpServer({ name: "mimiciv-mcp-stdio", version: "0.1.0" });

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

  registerClinicalTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // eslint-disable-next-line no-console
  console.log("MCP Server running (stdio transport)...");

  logger.info("stdio transport connected");
}

main().catch((err) => {
  logger.error("Fatal startup error", err);
  process.exit(1);
});
