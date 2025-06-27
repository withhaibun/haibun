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
export HAIBUN_O_HTTPEXECUTORSTEPPER_ACCESS_TOKEN=mooCowMoo

# Start the MCP server with monitoring enabled
node modules/cli/build/cli.js --cwd modules/mcp/runtime cli start-executor

echo "✅ MCP Server with monitoring started!"
echo "💡 Use MCP tools to interact with the browser and watch the results in the monitor"
