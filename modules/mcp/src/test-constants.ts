// Test port constants to avoid conflicts with live server instances
// Live servers use ports 8123-8125, so tests use 12000+ range
// MCP tests get 12300-12399 range

export const TEST_PORTS = {
  // MCP tests (12300-12399) - each test gets a group of 10 ports
  MCP_REMOTE_EXECUTOR: 12300,
  MCP_REMOTE_EXECUTION: 12310,
  MCP_SERVER_STDIO: 12320,
  MCP_CLIENT_TEST: 12330,
  MCP_CLIENT_SERVER: 12340,
  MCP_TOOL_EXECUTION: 12350,
  MCP_SERVER_STEPPER: 12360,
} as const;
