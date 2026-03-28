import path from "path";

import type {
	TWorld,
	TEndFeature,
	IStepperCycles,
} from "@haibun/core/lib/defs.js";
import { OK, type TStepArgs } from "@haibun/core/schema/protocol.js";
import {
	actionNotOK,
	getFromRuntime,
	getStepperOption,
	intOrError,
} from "@haibun/core/lib/util/index.js";
import {
	AStepper,
	type IHasCycles,
	type IHasOptions,
} from "@haibun/core/lib/astepper.js";
import {
	discoverSteps,
	validateToolInput,
	parseRpcRequest,
} from "@haibun/core/lib/step-dispatch.js";
import { validateStep } from "@haibun/core/lib/step-validation.js";

import { type IWebServer, WEBSERVER } from "./defs.js";
import { ServerHono, DEFAULT_PORT } from "./server-hono.js";
import { SSETransport, TRANSPORT, type ITransport } from "./sse-transport.js";

const cycles = (wss: WebServerStepper): IStepperCycles => ({
	async startFeature() {
		const filesBase = path.join(process.cwd(), "files");
		wss.webserver = new ServerHono(wss.world.eventLogger, filesBase);
		wss.getWorld().runtime[WEBSERVER] = wss.webserver;
		wss.getWorld().runtime[TRANSPORT] = new SSETransport(
			wss.webserver,
			wss.world.eventLogger,
		);
		await Promise.resolve();
	},
	async endFeature(wtw: TEndFeature) {
		if (wtw.shouldClose) {
			await wss.webserver?.close();
			wss.webserver = undefined;
		}
	},
});

class WebServerStepper extends AStepper implements IHasOptions, IHasCycles {
	description =
		"Serve static files, create directory indexes, and host web content";

	webserver: ServerHono | undefined;
	private steppers: AStepper[] = [];
	cycles: IStepperCycles = cycles(this);

	options = {
		PORT: {
			desc: `Change web server port from ${DEFAULT_PORT}`,
			parse: (port: string) => intOrError(port),
		},
		INTERFACE: {
			desc: "Change web server interface from default (127.0.0.1). e.g. 0.0.0.0",
			parse: (input: string) => ({ result: input }),
		},
	};
	port: number = DEFAULT_PORT;
	hostname?: string;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		const sname = this.constructor.name;
		const fromModule = (
			world.moduleOptions as unknown as Record<
				string,
				Record<string, unknown> | undefined
			>
		)?.[sname]?.["PORT"];
		const portOption =
			fromModule || getStepperOption(this, "PORT", world.moduleOptions);
		if (portOption) {
			const parsed = parseInt(String(portOption), 10);
			if (Number.isNaN(parsed) || parsed <= 0) {
				throw new Error(
					`WebServerStepper: PORT option "${portOption}" must be a positive integer`,
				);
			}
			this.port = parsed;
		}
		const interfaceOption = getStepperOption(
			this,
			"INTERFACE",
			world.moduleOptions,
		);
		if (interfaceOption) {
			this.hostname = String(interfaceOption);
		}
	}

	steps = {
		showPorts: {
			gwta: "show ports",
			action: () => {
				const ports = Object.fromEntries(ServerHono.listeningPorts);
				this.getWorld().eventLogger.info(
					`ports: ${JSON.stringify(ports, null, 2)}`,
					{ ports },
				);
				return OK;
			},
		},
		isListening: {
			gwta: "webserver is listening for {why}",
			action: async ({ why }: TStepArgs) => {
				await this.listen(String(why));
				return OK;
			},
		},
		showMounts: {
			gwta: "show mounts",
			action: () => {
				const webserver = getFromRuntime(
					this.getWorld().runtime,
					WEBSERVER,
				) as IWebServer;
				const mounts = webserver.mounted;
				this.getWorld().eventLogger.info(
					`mounts: ${JSON.stringify(mounts, null, 2)}`,
					{ mounts },
				);
				return Promise.resolve(OK);
			},
		},
		serveFiles: {
			gwta: "serve files from {loc}",
			action: ({ loc, why }: TStepArgs) => {
				try {
					this.webserver?.checkAddStaticFolder(String(loc), "/");
					return OK;
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					return actionNotOK(message);
				}
			},
		},
		serveFilesAt: {
			gwta: "serve files at {where} from {loc}",
			action: ({ where, loc }: TStepArgs) => {
				try {
					this.webserver?.checkAddStaticFolder(String(loc), String(where));
					return OK;
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					return actionNotOK(message);
				}
			},
		},
		indexFiles: {
			gwta: "index files from {loc}",
			action: ({ loc }: TStepArgs) => {
				try {
					this.webserver?.checkAddIndexFolder(String(loc), "/");
					return OK;
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					return actionNotOK(message);
				}
			},
		},
		showRoutes: {
			gwta: "show routes",
			action: () => {
				const routes = this.webserver?.mounted;
				this.getWorld().eventLogger.info(
					`routes: ${JSON.stringify(routes, null, 2)}`,
					{ routes },
				);
				return Promise.resolve(OK);
			},
		},
		enableRpc: {
			gwta: "enable rpc",
			action: () => {
				const transport = getFromRuntime(
					this.getWorld().runtime,
					TRANSPORT,
				) as ITransport;
				const { registry, metadata } = discoverSteps(
					this.steppers,
					this.getWorld(),
				);
				const logger = this.getWorld().eventLogger;

				transport.onMessage(async (raw: unknown) => {
					const msg = parseRpcRequest(raw);
					if (!msg) return;
					const { method, params, seqPath } = msg;

					if (method === "step.list") return metadata;
					if (method === "step.validate")
						return validateStep(String(params.text || ""), this.steppers);

					const tool = registry.get(method);
					if (!tool) return;

					try {
						const validatedParams = validateToolInput(tool, params);
						const hr = await tool.handler(validatedParams, seqPath);
						if (hr.ok) return hr.products;
						return { error: `${method}: ${(hr as { error: string }).error}` };
					} catch (err) {
						const detail = err instanceof Error ? err.message : String(err);
						logger.error(`[RPC] ${method}: ${detail}`);
						return { error: `${method}: ${detail}` };
					}
				});
				return OK;
			},
		},
	};

	async listen(why: string) {
		if (!this.webserver) {
			throw new Error(
				"WebServerStepper: webserver not initialized - ensure startFeature cycle ran",
			);
		}
		if (ServerHono.listeningPorts.has(this.port)) {
			return;
		}
		await this.webserver.listen(why, this.port, this.hostname);
	}
}

export default WebServerStepper;

export interface IWebServerStepper {
	webserver: IWebServer;
	close: () => void;
}
