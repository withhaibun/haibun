import path from "path";
import fs from "fs";
import { ServerHono } from "@haibun/web-server-hono/server-hono.js";
import { getPorts } from "../config.js";
import { serveStatic } from "@hono/node-server/serve-static";
import { SSETransport, TRANSPORT, type ITransport } from "@haibun/web-server-hono/sse-transport.js";
import { RemoteTransport } from "../remote-transport.js";

import MonitorBrowserStepper from "../monitor-browser-stepper.js";
import { fileURLToPath } from "url";
import { getStepperOption } from "@haibun/core/lib/util/index.js";
import { type IWebServer, WEBSERVER } from "@haibun/web-server-hono/defs.js";

export const setupTransport = async (monitorBrowser: MonitorBrowserStepper) => {
	const { clientPort, serverPort } = getPorts(process.env.NODE_ENV);
	const configuredPort = monitorBrowser.port || serverPort;

	await tryExisting(monitorBrowser, configuredPort).catch(async () => {
		await setupNew(monitorBrowser, configuredPort, clientPort);
	});

	if (!MonitorBrowserStepper.transport) {
		// Fallback just in case
		throw new Error("MonitorBrowserStepper: Transport initialization failed");
	}

	// Update prompter transport
	monitorBrowser.prompter?.setTransport(MonitorBrowserStepper.transport);

	// Send cwd to client
	MonitorBrowserStepper.transport.send({ type: "init", cwd: process.cwd() });
	return MonitorBrowserStepper.transport;
};

async function tryExisting(monitorBrowser: MonitorBrowserStepper, configuredPort: number) {
	// Try to connect to existing monitor
	const check = await fetch(`http://127.0.0.1:${configuredPort}/api/health`).catch((_e: unknown): null => null);
	if (check?.ok) {
		const text = await check.text();
		monitorBrowser.getWorld().eventLogger.debug(`MonitorBrowser: piggybacking on port ${configuredPort} (${text})`);
		// Client Mode
		MonitorBrowserStepper.transport = new RemoteTransport(
			`http://127.0.0.1:${configuredPort}/api/ingest`,
			monitorBrowser.getWorld().eventLogger,
		);
	} else {
		throw new Error("Not found");
	}
}

async function setupNew(monitorBrowser: MonitorBrowserStepper, configuredPort: number, clientPort: number) {
	const runtime = monitorBrowser.getWorld().runtime;

	// Use shared webserver/transport from runtime, or create own if WebServerStepper isn't present
	let server: IWebServer = runtime[WEBSERVER] as IWebServer;
	let transport: ITransport = runtime[TRANSPORT] as ITransport;

	if (!server) {
		const filesBase = path.join(process.cwd(), "files");
		server = new ServerHono(monitorBrowser.getWorld().eventLogger, filesBase);
		runtime[WEBSERVER] = server;
	}
	if (!transport) {
		transport = new SSETransport(server, monitorBrowser.getWorld().eventLogger);
		runtime[TRANSPORT] = transport;
	}

	// Serve capture artifacts (images, videos, etc.) from the storage location
	// Must be registered before wildcard static routes
	const captureRoot = monitorBrowser.storage.getArtifactBasePath();
	if (captureRoot) {
		await monitorBrowser.storage.ensureDirExists(captureRoot);
		server.app.use(
			"/featn-*",
			serveStatic({
				root: captureRoot,
				rewriteRequestPath: (reqPath) => reqPath,
			}),
		);
	}

	// Asset Serving (Dev vs Prod)
	let checkDev: Response | null = null;
	try {
		checkDev = await fetch(`http://127.0.0.1:${clientPort}`);
	} catch {
		// Dev server not running
	}

	const isDev = !!checkDev?.ok;

	if (isDev) {
		monitorBrowser.getWorld().eventLogger.info(`MonitorBrowser: Dev mode detected; proxying UI from port ${clientPort}`);
		const devOrigin = `http://127.0.0.1:${clientPort}`;
		server.app.use("/*", async (c, next) => {
			await next();
			if (c.res.status === 404) {
				const proxied = await fetch(`${devOrigin}${c.req.path}`).catch((): null => null);
				if (proxied?.ok) {
					c.res = new Response(proxied.body, {
						status: proxied.status,
						headers: proxied.headers,
					});
				}
			}
		});
	} else {
		// Prod: Serve static files
		const distPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/client");
		if (fs.existsSync(distPath)) {
			server.app.use("/*", serveStatic({ root: distPath }));
		} else {
			monitorBrowser.getWorld().eventLogger.info(`MonitorBrowser: no client build at ${distPath}`);
		}
	}

	// Add health/ingest endpoints for piggybackers
	let ingestCount = 0;
	server.addRoute("get", "/api/health", { description: "monitor-browser health probe" }, (c) => c.text(`OK ${process.pid}`));
	server.addRoute("get", "/api/ingest-count", { description: "monitor-browser ingested event counter" }, (c) => c.json({ count: ingestCount }));
	server.addRoute("post", "/api/ingest", { description: "monitor-browser event ingest endpoint for piggyback workers" }, async (c) => {
		const payload = await c.req.json();

		// Handle control messages (init)
		// Init messages have type='init' but NO kind (unlike Haibun events)
		if (payload.type === "init" && !payload.kind) {
			monitorBrowser.getWorld().eventLogger.info(`MonitorBrowser: ingested init from piggybacker`);
			MonitorBrowserStepper.transport?.send(payload);
			return c.text("OK");
		}

		// Default: Handle events
		const event = payload;
		ingestCount++;
		if (ingestCount === 1) {
			monitorBrowser.getWorld().eventLogger.info(`MonitorBrowser: ingested ${event.kind} from piggybacker`);
		}
		MonitorBrowserStepper.transport?.send({ type: "event", event });
		return c.text("OK");
	});

	// Listen on the shared server if not already listening
	if (!server.port) {
		monitorBrowser.interface = getStepperOption(monitorBrowser, "INTERFACE", monitorBrowser.getWorld().moduleOptions);
		await server.listen("monitor-browser", configuredPort, monitorBrowser.interface);
	}
	monitorBrowser.getWorld().eventLogger.info(`MonitorBrowser: hosting on port ${configuredPort} (PID: ${process.pid})`);
	MonitorBrowserStepper.transport = transport;
}
