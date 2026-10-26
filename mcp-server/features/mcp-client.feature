The MCP server responds to an MCP client.

This feature serves the steps over MCP, as serve-mcp does, and initializes with the endpoint as an MCP client does: a JSON-RPC initialize request in the body of a POST, whose result states the server's name.
serve mcp tools at "/mcp"
webserver is listening for "an MCP client"
make an HTTP POST to "http://localhost:8129/mcp" with {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"mcp-client","version":"1.0"}}}
HTTP status is 200
variable HTTP response.json.result.serverInfo.name is "haibun-mcp"
