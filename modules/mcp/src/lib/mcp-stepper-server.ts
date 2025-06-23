import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { AStepper } from "@haibun/core/build/lib/astepper.js";
import { namedInterpolation } from "@haibun/core/build/lib/namedVars.js";
import { currentVersion as version } from '@haibun/core/build/currentVersion.js';

export class MCPStepperServer {
	server: McpServer;
	constructor(private steppers: AStepper[]) { }
	async start() {
		this.server = new McpServer({
			name: "haibun-mcp",
			version,
			capabilities: {
				resources: {},
				tools: {},
			},
		});

		this.registerSteppers();
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
	}

	registerSteppers() {
		for (const stepper of this.steppers) {
			for (const [stepName, stepDef] of Object.entries(stepper.steps)) {
				const variables: Record<string, z.ZodTypeAny> = {};
				if (stepDef.gwta) {
					const { stepVariables } = namedInterpolation(stepDef.gwta);
					if (Array.isArray(stepVariables)) {
						for (const v of stepVariables) {
							variables[v.name] = v.type === 'number' ? z.number() : z.string();
						}
					}
				}
				const toolDescription = {
					description: stepName,
					title: (stepDef.gwta || stepDef.match?.toString() || stepDef.exact || stepName),
					...(Object.keys(variables).length ? { inputSchema: variables, variables } : {}),
				}
				this.server.registerTool(`${stepper.constructor.name}-${stepName}`, toolDescription,
					(input) => {
						const action = stepDef.action;
						return action.call(stepper, input, { in: "", path: "", seq: 0, action: { actionName: stepName, stepperName: stepper.constructor.name, step: stepDef } });
					}
				);
			}
		}
	}
}
