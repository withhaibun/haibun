/**
 * MCP over a server's routes: each step the caller holds is a tool, and a tool's call runs its step under what the request
 * presented, through the dispatch that `/rpc` calls take. A request is verified as a whole, the body its digest covers
 * included, before its server reads it.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import {
	ListToolsRequestSchema,
	CallToolRequestSchema,
	ListResourcesRequestSchema,
	ReadResourceRequestSchema,
	ErrorCode,
	McpError,
	type Tool,
	type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import type { AStepper } from "@haibun/core/lib/astepper.js";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import { answeredFor } from "@haibun/core/lib/call-step.js";
import type { StepRegistry } from "@haibun/core/lib/step-registry.js";
import { stepsInstructions, toolDefinition } from "@haibun/core/lib/step-discovery.js";
import { actingAs, authorizedWith, callerHolds, restingOn, runActingAs, runInvoking, shownTo } from "@haibun/core/lib/domains/capability-context.js";
import { ACTUALITY_HEADER, actualityRefusal, refusalSaid } from "@haibun/core/lib/rpc-wire.js";
import { admitsOrigin, PRESENTED_REQUEST_HEADERS } from "../domains/web-server.js";
import type { Context, IWebServer, TCapabilityVerifier } from "../ports.js";
import { actionsOf } from "../derivations/actions.js";
import { calledStep, dispatchedAs, type TCaller, type TDispatchWithin } from "./dispatch-call.js";
import { proveClaimed } from "@haibun/core/lib/step-dispatch.js";
import { refuseInvocation } from "./capability-verifier.js";

/** The name this MCP server states to its callers. */
const SERVER_NAME = "haibun-mcp";
/** The media types a caller of the endpoint accepts, which the transport requires a request to state. */
const ACCEPTS = "application/json, text/event-stream";
/** The header that states the media types a request accepts. */
const ACCEPT_HEADER = "Accept";

/** What serving MCP reads: actuality's world and steppers, the registry it lists, the server that mounts its routes, the
 *  verifier of each request's authority, and the path of its endpoint. */
export type TMcpParts = { world: TWorld; steppers: AStepper[]; registry: () => StepRegistry; webserver: IWebServer; verifier: TCapabilityVerifier; path: string; version: string };

/** The steps the caller holds, as tools, a step another host injected among them. */
const mcpTools = (registry: StepRegistry): Tool[] => registry.heldBy(shownTo()).map(toolDefinition);

/** A tool's result that refuses its call or states why its step failed. */
const failedTool = (text: string): CallToolResult => ({ isError: true, content: [{ type: "text", text }] });

/** Calls a step by its method, as a tool call names it, as `caller`. A model reads what its call changed next, so a call
 *  whose step names the read that serves it receives that read. */
async function callTool(parts: TMcpParts, name: string, args: Record<string, unknown>, caller: TCaller): Promise<CallToolResult> {
	const within: TDispatchWithin = { registry: parts.registry(), world: parts.world, steppers: parts.steppers };
	try {
		const called = calledStep(within, { method: name, params: args, asks: undefined, seqPath: undefined }, caller);
		if ("refused" in called) return failedTool(refusalSaid(called.refused));
		const dispatched = dispatchedAs(within, caller);
		const result = await runActingAs(caller.principal, async () => answeredFor(dispatched, called.tool, await proveClaimed(dispatched, called.featureStep)), caller.restsOn);
		if (!result.ok) return failedTool(result.errorMessage === undefined ? `the step ${name} failed without stating why` : result.errorMessage);
		return { content: [{ type: "text", text: JSON.stringify(result.products === undefined ? {} : result.products, null, 2) }] };
	} catch (err: unknown) {
		return failedTool(`the step ${name} didn't run: ${errorDetail(err)}`);
	}
}

/** The caller of the request in progress, as the endpoint's middleware verified it. */
function callerOfRequest(verifier: TCapabilityVerifier): TCaller {
	const held = actionsOf(callerHolds());
	const principal = actingAs();
	return { granted: actionsOf(authorizedWith()), held, principal, restsOn: restingOn(), delegate: verifier.delegateOf({ held, principal }) };
}

/**
 * The server that serves one request. A server and its transport hold the requests in flight by the id each caller
 * chose, so one shared by callers would give one caller's result to another where both chose one id. Each request has
 * its own, as the MCP SDK's stateless server does, and a caller's session is the requests it signs.
 */
function mcpServerOf(parts: TMcpParts): McpServer {
	const info = `mcp://${parts.path}/info`;
	// A host places a server's instructions in its model's context. They are set before a caller's steps are read, so they
	// don't name a stepper: a caller finds the steps it holds in the tool list and by discovery.
	const mcpServer = new McpServer(
		{ name: SERVER_NAME, version: parts.version },
		{ capabilities: { tools: { listChanged: true }, resources: {} }, instructions: stepsInstructions([]) },
	);
	// Each step the caller holds is a tool. Which of them a model receives at once is its host's choice, as the MCP client
	// best practices place it; a host without a search of its own finds steps with the show steps step, which is a tool too.
	mcpServer.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: mcpTools(parts.registry()) }));
	// A call runs under what its request presented, which the middleware verified over the whole request.
	mcpServer.server.setRequestHandler(CallToolRequestSchema, (request) => {
		const args = request.params.arguments;
		return callTool(parts, request.params.name, args === undefined ? {} : args, callerOfRequest(parts.verifier));
	});
	mcpServer.server.setRequestHandler(ListResourcesRequestSchema, () => ({
		resources: [{ uri: info, name: "Haibun MCP Server Info", mimeType: "application/json", description: "Basic information about this MCP server" }],
	}));
	mcpServer.server.setRequestHandler(ReadResourceRequestSchema, (request) => {
		if (request.params.uri !== info) throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${request.params.uri}`);
		return { contents: [{ uri: request.params.uri, mimeType: "application/json", text: JSON.stringify({ version: parts.version, name: SERVER_NAME, status: "running" }) }] };
	});
	return mcpServer;
}

/** Mounts the MCP endpoint at its path: the middleware that verifies each request, and the routes that serve it. */
export function serveMcp(parts: TMcpParts): void {
	const { webserver, path } = parts;
	const middleware = verifiedRequests(parts);
	const route = (c: Context) => servedRequest(parts, c);
	for (const at of [path, `${path}/*`]) {
		webserver.app.use(at, middleware);
		webserver.app.all(at, route);
	}
}

/** The endpoint's middleware: CORS for a page at an origin the server admits, and each request's authority verified over
 *  the whole request. */
function verifiedRequests({ world, verifier, webserver }: TMcpParts) {
	return async (c: Context, next: () => Promise<void>) => {
		const origin = c.req.header("origin");
		c.header("Vary", "Origin");
		if (origin !== undefined && admitsOrigin(webserver.origins, origin)) c.header("Access-Control-Allow-Origin", origin);
		c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		c.header("Access-Control-Allow-Headers", ["content-type", "accept", ...PRESENTED_REQUEST_HEADERS].join(", "));
		if (c.req.method === "OPTIONS") return c.body(null, 204);
		// What the request presents is verified over the whole request, the body its digest covers included, and every call
		// it carries runs under that and what the deployment allows without a delegation, and only those: the server was
		// started inside a step of actuality, and a caller doesn't hold what that step held.
		const body = c.req.method === "POST" ? await c.req.raw.clone().text() : undefined;
		const authority = await verifier.authorityOf({ method: c.req.method, url: c.req.url, headers: c.req.header(), body });
		const { granted, held, principal, refused, restsOn } = authority;
		if (refused) return refuseInvocation(c, refused);
		// A call that states the actuality it reads is held to it, as a follower of the event stream is; one that doesn't
		// state it is served, so a client whose configuration names its headers isn't refused after a restart.
		const otherActuality = actualityRefusal(c.req.header(ACTUALITY_HEADER), world.runtime.actualityId);
		if (otherActuality) return c.json(otherActuality, 400);
		// An event stream is sent uncompressed.
		c.header("Cache-Control", "no-transform");
		await runInvoking({ invoked: granted, held }, () => runActingAs(principal, next, restsOn));
	};
}

/**
 * Serves one MCP request through a server of its own. The transport reads the request's Accept header, which a caller
 * may leave out, so the request it reads states one. A POST's body is read once, so its request is proxied rather than
 * rebuilt, and every function of Hono's context stays bound to its own target, whose private fields it reads.
 */
async function servedRequest(parts: TMcpParts, c: Context): Promise<Response> {
	if (c.req.method !== "POST" && c.req.method !== "GET") return c.body(null, 405, { Allow: "GET, POST" });
	const headers = new Headers(c.req.raw.headers);
	if (!headers.has(ACCEPT_HEADER)) headers.set(ACCEPT_HEADER, ACCEPTS);
	const raw = c.req.method === "GET" ? new Request(c.req.raw, { headers }) : bound(c.req.raw, { headers });
	const header = (name?: string) => (name ? headers.get(name) : Object.fromEntries(headers.entries()));
	const context = bound(c, { req: bound(c.req, { raw, header }) });
	const mcpServer = mcpServerOf(parts);
	const transport = new StreamableHTTPTransport({ enableJsonResponse: true });
	await mcpServer.connect(transport);
	if (c.req.method === "GET") {
		// A stream its caller holds open receives a notice each time the steps change, until the caller closes it or the
		// authority it was opened under lapses, as a follower of the event stream is.
		const stopListening = parts.registry().onChange(() => {
			void mcpServer.server.sendToolListChanged().catch((err: unknown) => parts.world.eventLogger.warn(`[MCP] the tool list change was not sent: ${errorDetail(err)}`));
		});
		const held = new AbortController();
		held.signal.addEventListener("abort", () => (stopListening(), void mcpServer.close()), { once: true });
		c.req.raw.signal.addEventListener("abort", () => held.abort("the client left"), { once: true });
		parts.verifier.endWhenLapsed(restingOn(), held.signal, (reason) => held.abort(reason));
		const opened = await transport.handleRequest(context);
		if (!opened) throw new Error("[MCP] the transport didn't open the stream; the request's Accept header must include text/event-stream");
		return opened;
	}
	try {
		const response = await transport.handleRequest(context);
		if (!response) throw new Error("[MCP] the transport didn't serve the request; send a JSON-RPC message in the request's body");
		return response;
	} finally {
		await mcpServer.close();
	}
}

/** `target` read through a proxy that returns `replaced` in place of its properties, with each of its own functions bound
 *  to it. */
function bound<T extends object>(target: T, replaced: Record<string, unknown>): T {
	return new Proxy(target, {
		get(of, property) {
			if (typeof property === "string" && Object.hasOwn(replaced, property)) return replaced[property];
			const value: unknown = Reflect.get(of, property);
			return typeof value === "function" ? value.bind(of) : value;
		},
	});
}
