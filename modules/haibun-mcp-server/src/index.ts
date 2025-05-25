import { startServer } from './server';

export function startMcpServer() {
  console.log("MCP Server starting...");
  startServer();
}

// Optional: allow running the server directly for testing
if (require.main === module) {
  startMcpServer();
}
