#!/bin/bash

# Script to run Haibun MCP server with monitoring enabled
# This allows you to watch browser automation in real-time while using MCP tools

echo "🚀 Starting Haibun MCP Server with Web-Playwright Monitor..."
echo "📊 Monitor will be available at: http://localhost:3000/monitor.html"
echo "🔧 MCP tools available include: WebPlaywright-takeSnapshot, WebPlaywright-takeScreenshot"
echo ""

# Set environment variables for monitoring and storage
export HAIBUN_O_WEBPLAYWRIGHT_MONITOR=all
export HAIBUN_O_WEBPLAYWRIGHT_STORAGE=StorageMem
export HAIBUN_O_WEBPLAYWRIGHT_HEADLESS=false
export HAIBUN_O_HTTPEXECUTORSTEPPER_LISTEN_PORT=8125
export HAIBUN_O_HTTPEXECUTORSTEPPER_ACCESS_TOKEN=localTest

# Start the HTTP executor only (no MCP server - VS Code will handle that)
node modules/cli/build/cli.js -c ./modules/mcp/runtime/config.json ./modules/mcp/runtime/http-only

echo "✅ HTTP Executor with monitoring started!"
echo "🔌 VS Code MCP will connect to this HTTP executor on port 8125"
echo "💡 Use MCP tools in VS Code to interact with the browser and watch the results in the monitor"
