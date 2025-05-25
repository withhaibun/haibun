import Fastify, { FastifyInstance } from 'fastify'
import mcpPlugin from "@mcp-it/fastify";

import { actionNotOK, intOrError } from '@haibun/core/build/lib/util/index.js';
import { OK, TActionResult, TNamed } from '@haibun/core/build/lib/defs.js';
import { AStepper, IHasOptions } from '@haibun/core/build/lib/astepper.js';
import { getDefaultWorld } from '@haibun/core/build/lib/test/lib.js';
import { namedInterpolation } from '@haibun/core/build/lib/namedVars.js';

export const DEFAULT_PORT = 4142;

const sy = (o: object) => JSON.stringify(o, null, 2);

export async function createFastifyServer(port: number, steppers: AStepper[]): Promise<FastifyInstance> {
	const fastify = Fastify();

	await fastify.register(mcpPlugin, {
		name: "Stepper API",
		description: "Stepper API with MCP support",
		addDebugEndpoint: true,
		describeFullSchema: true
	});

	fastify.get(
		"/steppers",
		{
			schema: {
				operationId: "list_steppers",
				summary: "List all steppers with their OpenAPI schemas",
				description: "Returns a list of all steppers, including their OpenAPI schemas.",
				response: {
					200: {
						description: "Successful response",
						type: "array",
						items: {
							type: "object",
							properties: {
								operationId: { type: "string" },
								description: { type: "string" },
								params: { type: "object" },
								response: { type: "string" },
							},
						},
					},
					500: {
						description: "Error response",
						type: "object",
						properties: {
							error: { type: "string" },
						},
					},
				},
			},
		},
		async (req, res) => {
			try {
				console.debug("Received request for /steppers");
				const steppersInfo = describeSteppers(steppers);
				console.debug("Steppers info to be sent:", JSON.stringify(steppersInfo, null, 2));
				await res.header('Content-Type', 'application/json').send(JSON.stringify(steppersInfo));
			} catch (error) {
				console.error("Error in /steppers endpoint:", error);
				await res.status(500).send({ error: error.message });
			}
		}
	);

	await fastify.listen({ port });
	console.info(`MCP SSE server running at http://localhost:${port}/mcp/sse`);

	return fastify;
}

function describeSteppers(steppers: AStepper[]) {
	console.log('describing steppers', steppers);
	return steppers.flatMap((stepper) => {
		return Object.entries(stepper.steps).map(([stepName, stepDetails]) => {
			let properties: { [name: string]: { type: string } } = {};
			if (stepDetails.gwta) {
				const { vars } = namedInterpolation(stepDetails.gwta);
				console.debug(`Extracted vars for step '${stepName}':`, vars);
				if (vars) {
					properties = vars.reduce((acc, { name, type }) => {
						acc[name] = { type };
						return acc;
					}, {});
				}
			}
			console.debug(`Properties for step '${stepName}':`, JSON.stringify(properties, null, 2));
			const response = `${sy(OK)} || ${sy(actionNotOK('reason'))}`;
			const stepInfo = {
				operationId: stepName,
				description: stepDetails.gwta || stepDetails.match || "No description",
				params: {
					type: "object",
					properties,
				},
				response,
				stepper: stepper.constructor.name, // Include the stepper name
			};
			console.debug(`Step info for '${stepName}':`, JSON.stringify(stepInfo, null, 2));
			return stepInfo;
		});
	});
}

export class McpServer extends AStepper implements IHasOptions {
	options = {
		port: {
			parse: (input: string) => intOrError(input),
			desc: "Port for the MCP server",
		},
	};
	port: number = DEFAULT_PORT;
	steppers: AStepper[] = [];
	fastify: FastifyInstance;

	steps = {
		startServer: {
			gwta: `start mcp server at port {port}`,
			action: async ({ port }: TNamed): Promise<TActionResult> => {
				this.port = parseInt(port);
				this.fastify = await createFastifyServer(this.port, this.steppers);
				return OK;
			},
		},
		stopServer: {
			gwta: `stop mcp server`,
			action: async (): Promise<TActionResult> => {
				if (this.fastify) {
					await this.fastify.close();
					console.log("MCP server stopped.");
				}
				return OK;
			},
		},
	};

	async stopServer() {
		if (this.fastify) {
			await this.fastify.close();
			console.log("MCP server stopped.");
		}
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	void (async () => {
		const mcpServer = new McpServer();
		const mockWorld = getDefaultWorld(0);
		const testStepper = new (class extends AStepper {
			steps = {};
		})();

		try {
			await mcpServer.setWorld(mockWorld, [testStepper]);
			if (mcpServer.port !== undefined) {
				await mcpServer.steps.startServer.action({ port: mcpServer.port.toString() });
			} else {
				throw new Error('Port is not defined');
			}
		} catch (error) {
			console.error("Failed to start MCP server:", error);
		}
	})();
}
