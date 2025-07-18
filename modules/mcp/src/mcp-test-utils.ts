import { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";

// used to configure the client to start the STUDIO server, which is a Haibun stepper
export const runtimeStdio = (port?: number) => {
	const listening = port ? {
		'HAIBUN_O_HTTPEXECUTORSTEPPER_LISTEN_PORT': port.toString(),
		'HAIBUN_O_HTTPEXECUTORSTEPPER_ACCESS_TOKEN': 'test-token-client',
		'HAIBUN_O_MCPSERVERSTEPPER_REMOTE_PORT': port.toString(),
		'HAIBUN_O_MCPSERVERSTEPPER_ACCESS_TOKEN': 'test-token-client'
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
	MCP_CLIENT_LIST_TOOLS: 12342,
	MCP_CLIENT_PROMPTER: 12341,
	MCP_TOOL_EXECUTION: 12350,
	MCP_HTTP_PROMPTER_TEST: 12370,
	MCP_EXECUTOR_PROMPTER_TEST_EXECUTOR: 12381,
	MCP_EXECUTOR_PROMPTER_TEST_DEBUG: 12383,
	MCP_DEBUG_STEPS_TEST: 12390,
} as const;
