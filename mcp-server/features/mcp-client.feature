The MCP server responds to an MCP client.

This feature serves the steps over MCP, as serve-mcp does, and initializes with the endpoint as an MCP client does: a JSON-RPC initialize request in the body of a POST, whose result states the server's name. The request is sent from a page the server serves, since the endpoint allows a cross-origin call only from an origin the server names.
serve mcp tools at "/mcp"
serve files at "/client" from "mcp-client"
webserver is listening for "an MCP client"
go to the "http://localhost:8129/client/index.html" webpage
make an HTTP POST to "http://localhost:8129/mcp" with {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"mcp-client","version":"1.0"}}}
HTTP status is 200
variable HTTP response.json.result.serverInfo.name is "haibun-mcp"
