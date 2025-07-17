# Haibun MCP Module

Enables agents to interact with Haibun steppers through the standardized [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

## Quick Start

### 1. Run exampe external HTTP executor
```bash

./run-mcp-with-monitor.sh

```

### 2. VS Code MCP Configuration
Add to your VS Code `mcp.json`:
```json
{
  "servers": {
    "haibun-mcp": {
      "type": "stdio",
      "command": "node",
      "cwd": "/path/to/haibun",
      "args": [
        "modules/cli/build/cli.js",
        "-c",
        "./modules/mcp/runtime/agent/config.json",
        "./modules/mcp/runtime/agent"
      ],
      "env": {
        "HAIBUN_O_WEBPLAYWRIGHT_STORAGE": "StorageMem",
        "HAIBUN_O_MCPSERVERSTEPPER_REMOTE_PORT": "8125",
        "HAIBUN_O_MCPSERVERSTEPPER_ACCESS_TOKEN": "localTest"
      }
    }
  }
}
```

### 3. Use MCP Tools
Available tools automatically expose all Haibun steppers:
- `WebPlaywright-gotoPage` - Navigate to web pages  
- `WebPlaywright-click` - Click elements
- `WebPlaywright-shouldSeeText` - Verify page content
- `VariablesStepper-set` - Set variables
- `Haibun-pauseSeconds` - Add delays
- And all other loaded steppers

## Architecture

**External Runtime** 
- Runs HTTP executor with monitoring
- Provides step execution API on port 8125
- Browser automation visible in monitor

**MCP Agent** 
- Lightweight process that connects to external runtime
- Exposes remote steppers as MCP tools via stdio
- Acts as bridge between eg VS Code and your tests

## Advanced Usage

### Local MCP Server (no external runtime)
```bash
HAIBUN_O_WEBPLAYWRIGHT_STORAGE=StorageMem \
node modules/cli/build/cli.js -c ./modules/mcp/runtime/config.json ./modules/mcp/runtime/local
```

### HTTP API Direct Access
```bash
curl -X POST http://localhost:8125/execute-step \
  -H "Authorization: Bearer localTest" \
  -H "Content-Type: application/json" \
  -d '{"statement": "pause for 1s", "source": "/api"}'
```

### Control from Haibun Features
```gherkin
Start MCP server.
serve mcp tools from steppers

Enable remote execution.
enable remote executor
```

## Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `HAIBUN_O_HTTPEXECUTORSTEPPER_LISTEN_PORT` | HTTP API port (e.g., 8125) |
| `HAIBUN_O_HTTPEXECUTORSTEPPER_ACCESS_TOKEN` | HTTP API auth token |
| `HAIBUN_O_MCPSERVERSTEPPER_REMOTE_PORT` | Connect to remote HTTP executor |
| `HAIBUN_O_MCPSERVERSTEPPER_ACCESS_TOKEN` | Remote executor auth token |
| `HAIBUN_O_WEBPLAYWRIGHT_STORAGE` | Storage backend (StorageMem) |
