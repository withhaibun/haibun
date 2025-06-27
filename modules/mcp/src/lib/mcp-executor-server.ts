import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, ZodRawShape } from "zod";
import type { TextContent } from '@modelcontextprotocol/sdk/types.js';

import { AStepper } from "@haibun/core/build/lib/astepper.js";
import { namedInterpolation } from "@haibun/core/build/lib/namedVars.js";
import { currentVersion as version } from '@haibun/core/build/currentVersion.js';
import { TWorld, TStepperStep, TStepResult } from "@haibun/core/build/lib/defs.js";
import { constructorName } from "@haibun/core/build/lib/util/index.js";
import { getActionableStatement } from '@haibun/core/build/phases/Resolver.js';
import { FeatureExecutor } from "@haibun/core/build/phases/Executor.js";

type ToolHandlerResponse = { content?: TextContent[] };

interface RemoteExecutorConfig {
	url: string;
	accessToken?: string;
}

export class MCPExecutorServer {
	server: McpServer;
	constructor(private steppers: AStepper[], private world: TWorld, private remoteConfig?: RemoteExecutorConfig) { }

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

				const toolName = `${stepperName}-${stepName}`;
				this.server.registerTool(toolName, toolDescription, this.createToolHandler(stepperName, stepName, stepDef));
			}
		}
	}
	private createToolHandler(stepperName: string, stepName: string, stepDef: TStepperStep) {
		return async (input: Record<string, string | number | boolean | string[]>): Promise<ToolHandlerResponse> => {
			try {
				let statement = stepDef.gwta || stepDef.exact || stepDef.match?.toString();

				if (stepDef.gwta && Object.keys(input).length > 0) {
					for (const [key, value] of Object.entries(input)) {
						const pattern = new RegExp(`\\{${key}(:[^}]*)?\\}`, 'g');
						statement = statement.replace(pattern, String(value));
					}
				}

				const stepResult: TStepResult = this.remoteConfig
					? await this.executeViaRemoteApi(statement, `/mcp/${stepperName}-${stepName}`)
					: await this.executeInCurrentRuntime(statement, `/mcp/${stepperName}-${stepName}`);

				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							stepName,
							stepperName,
							input,
							result: stepResult,
							success: stepResult.ok !== false
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

	private async executeInCurrentRuntime(statement: string, source: string) {
		const { featureStep } = await getActionableStatement(this.steppers, statement, source);
		return await FeatureExecutor.doFeatureStep(this.steppers, featureStep, this.world);
	}

	private async executeViaRemoteApi(statement: string, source: string) {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		if (this.remoteConfig!.accessToken) {
			headers.Authorization = `Bearer ${this.remoteConfig!.accessToken}`;
		}

		const maxRetries = 3;
		const retryDelay = 1000;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const response = await fetch(`${this.remoteConfig!.url}/execute-step`, {
					method: 'POST',
					headers,
					body: JSON.stringify({ statement, source })
				});

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`Remote execution failed: ${response.status} ${errorText}`);
				}

				const responseData = await response.json();
				return responseData;

			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);

				if (attempt === maxRetries) {
					throw new Error(`Remote execution failed after ${maxRetries} attempts: ${errorMessage}`);
				}

				// Log retry attempt and wait before retrying
				console.warn(`Remote execution attempt ${attempt} failed: ${errorMessage}. Retrying in ${retryDelay}ms...`);
				await new Promise(resolve => setTimeout(resolve, retryDelay));
			}
		}
	}
}
