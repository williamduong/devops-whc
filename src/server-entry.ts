import { startMcpServer } from "./server";

startMcpServer().catch((error) => {
  const message = error instanceof Error ? error.message : "MCP server startup failed";
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
