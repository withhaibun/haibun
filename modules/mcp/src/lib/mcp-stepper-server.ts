import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, ZodRawShape } from "zod";
import type { TextContent } from '@modelcontextprotocol/sdk/types.js';

import { AStepper } from "@haibun/core/build/lib/astepper.js";
import { namedInterpolation } from "@haibun/core/build/lib/namedVars.js";
import { currentVersion as version } from '@haibun/core/build/currentVersion.js';
import { TWorld, TFeatureStep, TStepAction, TStepperStep } from "@haibun/core/build/lib/defs.js";
import { constructorName } from "@haibun/core/build/lib/util/index.js";
import { Executor } from "@haibun/core/build/phases/Executor.js";
import { getNamedToVars } from "@haibun/core/build/lib/namedVars.js";

type ToolHandlerResponse = { content?: TextContent[] };

export class MCPStepperServer {
	server: McpServer;
	constructor(private steppers: AStepper[], private world: TWorld) { }

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
			const stepperName = constructorName(stepper);
			for (const [stepName, stepDef] of Object.entries(stepper.steps)) {
				const variables: ZodRawShape = {};
				if (stepDef.gwta) {
					const { stepVariables } = namedInterpolation(stepDef.gwta);
					if (Array.isArray(stepVariables)) {
						for (const v of stepVariables) {
							variables[v.name] = v.type === 'number' ? z.number() : z.string();
						}
					}
				}
				const toolDescription: {
                    description: string;
                    title: string;
                    inputSchema?: ZodRawShape;
                } = {
					description: stepName,
					title: (stepDef.gwta || stepDef.match?.toString() || stepDef.exact || stepName),
				}
                if (Object.keys(variables).length > 0) {
                    toolDescription.inputSchema = variables;
                }

				this.server.registerTool(`${stepperName}-${stepName}`, toolDescription, this.createToolHandler(stepperName, stepName, stepDef));
			}
		}
	}
	private createToolHandler(stepperName: string, stepName: string, stepDef: TStepperStep) {
		return async (input: Record<string, string | number | boolean | string[]>): Promise<ToolHandlerResponse> => {
			try {
				const stepAction: TStepAction = {
					actionName: stepName,
					stepperName: stepperName,
					step: stepDef
				};

				const featureStep: TFeatureStep = {
					path: 'mcp-execution',
					in: stepDef.gwta || stepDef.exact || stepName,
					seq: 1,
					action: stepAction
				};

				const namedWithVars = getNamedToVars(stepAction, this.world, featureStep);

				Object.assign(namedWithVars, input);

				const result = await Executor.action(this.steppers, featureStep, stepAction, namedWithVars, this.world);

				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							stepName,
							stepperName,
							input,
							result,
							success: result.ok !== false
						}, null, 2)
					}]
				};

			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							stepName,
							stepperName,
							input,
							error: errorMessage,
							success: false
						}, null, 2)
					}]
				};
			}
		}
	}
}
