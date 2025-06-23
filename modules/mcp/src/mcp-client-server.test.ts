import { describe, it, expect } from 'vitest';
import MCPClientStepper from './mcp-client-stepper.js';
import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import { getStepperOptionName } from '@haibun/core/build/lib/util/index.js';
import { TAnyFixme } from '@haibun/core/build/lib/fixme.js';
import { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('mcp client - server integration', () => {
	it('client can list tools from server', async () => {
		const serverParameters: StdioServerParameters = {
			command: "tsx",
			args: [
				"/home/vid/D/dev/withhaibun/haibun/modules/cli/build/cli.js",
				"--cwd",
				"/home/vid/D/dev/withhaibun/haibun/modules/mcp/test",
				"tests"
			],
		};

		const feature = { path: '/features/test.feature', content: `lists mcp tools` };
		const res = await testWithDefaults([feature], [MCPClientStepper], {
			options: { DEST: DEFAULT_DEST },
			moduleOptions: { [getStepperOptionName(MCPClientStepper, MCPClientStepper.SERVER)]: JSON.stringify(serverParameters) },
		});
		expect(res.ok).toBe(true);
		console.log('🤑', JSON.stringify(res.featureResults, null, 2));
		const stepResult = res.featureResults?.[0]?.stepResults?.[0]?.stepActionResult;
	});
});
