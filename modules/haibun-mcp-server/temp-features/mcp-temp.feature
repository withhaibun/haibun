Feature: MCP Execution via temp file
  Scenario: Execute a simple step from vars.ts
    Given I set "mcp_message" to "Hello from MCP via temp file"
    Then variable "mcp_message" is "Hello from MCP via temp file"
