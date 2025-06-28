import { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";

// used to configure the client to start the STUDIO server, which is a Haibun stepper
export const runtimeStdio = (port?: number) => {
	const listening = port ? {
		'HAIBUN_O_HTTPEXECUTORSTEPPER_LISTEN_PORT': port.toString(),
		'HAIBUN_O_HTTPEXECUTORSTEPPER_ACCESS_TOKEN': 'test-token-client'
	} : {};
	const config: StdioServerParameters = {
		command: process.execPath,
		env: {
			'HAIBUN_O_WEBPLAYWRIGHT_STORAGE': 'StorageMem',
			'HAIBUN_O_WEBPLAYWRIGHT_HEADLESS': 'true',
			...listening
		},
		args: [
			"modules/cli/build/cli.js",
			'--cwd',
			'modules/mcp/runtime',
			port ? 'http' : 'local',
		],
	}
	return JSON.stringify(config, null, 2);
}


export const TEST_PORTS = {
	MCP_REMOTE_EXECUTOR: 12300,
	MCP_REMOTE_EXECUTION: 12310,
	MCP_CLIENT_SERVER: 12340,
	MCP_TOOL_EXECUTION: 12350,
} as const;
