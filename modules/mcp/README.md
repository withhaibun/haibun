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

To enable remote execution with authentication:

```bash
# Start Haibun with remote executor enabled and access token
HAIBUN_O_REMOTE_EXECUTOR=true HAIBUN_O_ACCESS_TOKEN=your-secret-token node modules/cli/build/cli.js --cwd modules/mcp/test tests
```

Then configure the MCP server to use the remote endpoint:

```typescript
const mcpServer = new MCPExecutorServer(steppers, world, {
  url: 'http://localhost:8123',  // Default web server port
  accessToken: 'your-secret-token'
});
```

⚠️ **Security Warning**: The remote executor exposes execution context via HTTP. Only use in secure, controlled environments with proper authentication.

### Starting an MCP Server

The MCP Server is a Haibun stepper. For an example implementation with representative steppers, use:

```bash
HAIBUN_O_WEBPLAYWRIGHT_STORAGE=StorageMem node modules/cli/build/cli.js --cwd modules/mcp/test tests
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
