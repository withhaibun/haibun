# Haibun MCP Module

Enables agents to interact with Haibun steppers through the standardized [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

This module provides both server and client capabilities for MCP integration with Haibun.

## MCP Server

The **MCP Server** automatically exposes all available Haibun steppers as MCP tools, allowing external agents to:

- **Access all configured Haibun modules** seamlessly
- **Discover available tools** through MCP's tool listing protocol
- **Execute any stepper functionality** available in your workspace

### Remote Execution Support

For enhanced security and isolation, the MCP server can connect to a remote Haibun execution context via HTTP. This is particularly useful when:

- The execution environment needs to be isolated from the MCP server
- You want to pause execution and interact via an IDE or other tools
- Multiple agents need to share the same execution context

#### Configuration

⚠️ **Security Requirement**: ACCESS_TOKEN is mandatory when enabling remote execution. The system will fail fast if a port is configured without proper authentication.

To enable remote execution, configure both the HTTP executor and MCP server with matching ports and tokens:

```bash
# Start Haibun with remote executor enabled and access token
HAIBUN_O_WEBPLAYWRIGHT_STORAGE=StorageMem \
HAIBUN_O_HTTPEXECUTORSTEPPER_LISTEN_PORT=8124 \
HAIBUN_O_HTTPEXECUTORSTEPPER_ACCESS_TOKEN=your-secret-token \
node modules/cli/build/cli.js --cwd modules/mcp/test tests
```

If you want the MCP server to connect to a remote execution endpoint, configure it explicitly:

```bash
# Configure MCP server to use remote execution
HAIBUN_O_MCPSERVERSTEPPER_REMOTE_PORT=8124 \
HAIBUN_O_MCPSERVERSTEPPER_ACCESS_TOKEN=your-secret-token \
node modules/cli/build/cli.js --cwd modules/mcp/test tests
```

**Important**: Both steppers require explicit configuration. The ACCESS_TOKEN must match between the HTTP executor and MCP server for successful authentication.

#### Remote Execution API

When the HTTP executor is running, you can interact with it directly via HTTP API. All requests require authentication via the ACCESS_TOKEN.

**Execute a step:**
```bash
curl -X POST http://localhost:8124/execute-step \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token" \
  -d '{
    "statement": "I set MY_VAR to hello world",
    "source": "direct-api-call"
  }'
```

**Stop the remote executor:**
```bash
curl -X POST http://localhost:8124/execute-step \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token" \
  -d '{
    "statement": "I set finished-mcp-cli to true",
    "source": "direct-api-call"
  }'
```

Both `statement` and `source` fields are required in all requests.

### Starting an MCP Server

The MCP Server is a Haibun stepper. For a basic example with representative steppers:

```bash
# Basic local execution
HAIBUN_O_WEBPLAYWRIGHT_STORAGE=StorageMem \
node modules/cli/build/cli.js --cwd modules/mcp/test tests
```

Or with remote execution enabled:

```bash
# With remote execution capability
HAIBUN_O_WEBPLAYWRIGHT_STORAGE=StorageMem \
HAIBUN_O_HTTPEXECUTORSTEPPER_LISTEN_PORT=8124 \
HAIBUN_O_HTTPEXECUTORSTEPPER_ACCESS_TOKEN=your-secret-token \
node modules/cli/build/cli.js --cwd modules/mcp/test tests
```

### Using from External MCP Clients
Any MCP-compatible client can discover and call the exposed tools. The exact tools available depend on which Haibun modules are configured in your workspace.

### Server Control from Haibun Features
```gherkin
Feature: MCP Server Management
  Scenario: Start and stop MCP server
    Given I serve mcp tools from steppers

    The server is now running and exposing tools to external MCP clients.

    When I stop mcp tools
    The server is stopped.

  Scenario: Enable remote execution API
    Given I enable remote executor

    Now external MCP servers can connect to this execution context via HTTP.

    When I finished mcp cli
    The remote executor is stopped.
```

## MCP Client

The **MCP Client** allows Haibun features to connect to external MCP servers and discover their available tools.

### Client Usage from Haibun Features
```gherkin
Feature: External MCP Integration
  Scenario: List tools from external server
    When I list mcp tools

    This discovers all tools available from the configured MCP server.
```

### Client Configuration
The client requires server connection parameters to be configured via module options:
```json
{
  "MCPClientStepper": {
    "SERVER": "{\"command\": \"node\", \"args\": [\"server.js\"], \"env\": {}}"
  }
}
```

## Examples

### Server Tools
Depending on which Haibun modules you have configured, you might see tools like:

- `VariablesStepper-set` - Set variable values
- `VariablesStepper-display` - Display variable values
- `WebPlaywright-gotoPage` - Navigate to web pages
- `Haibun-comment` - Add comments
- Any custom steppers you've created

The specific tools available depend entirely on your Haibun workspace configuration.

### Client Tools
- `list mcp tools` - Discover tools available from external MCP servers

## Benefits

- **Zero Configuration**: Server automatically exposes all available steppers
- **Standardized Protocol**: Uses industry-standard MCP
- **Bidirectional**: Both server and client capabilities
- **Type Safe**: Full parameter validation
