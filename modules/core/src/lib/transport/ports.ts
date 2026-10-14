/**
 * The ports of the transport: the JSON-RPC wire between a haibun host and its callers, which every sender and every
 * server of a call reads. It states the request envelope, the handshake, a refusal and its remedy, and the reader of a
 * streamed response.
 *
 * The browser conduit sends the same envelopes and reads the same streams as rpc-client. rpc-client imports node-only
 * capability context, so the wire is a separate module. The browser and the server callers both import this module, so
 * both send a field added to the envelope. The client adapters send what this module states, and the step infrastructure
 * reads the refusals it states.
 */
import { z } from "zod";
import { AccessLevelSchema } from "../resources.js";

/** Identifies the actuality whose records a host holds. A host starts with a new one. A store that keeps its records
 *  across processes replaces it with the id stored beside those records. */
export const ActualityIdSchema = z.uuid();
export type TActualityId = z.infer<typeof ActualityIdSchema>;
/** Returns a new actualityId for records that start empty. */
export const newActualityId = (): TActualityId => crypto.randomUUID();

/** The route under which a host serves calls. The method name follows it in the path. */
export const RPC_ROUTE = "/rpc/";

/** The route that streams actuality's events to a follower. */
export const SSE_ROUTE = "/sse";

/** The header that carries the actualityId a request reads. A follower of actuality's events sends it. An MCP call can send it. */
export const ACTUALITY_HEADER = "actuality-id";

/** The handshake method. The host's response holds its hostId and site, and the actualityId that every other call states. */
export const ACTION_BEGIN = "action.begin";

/** The RPC protocol version this code implements. Every call states it. The handshake response holds it. An instance
 *  refuses a call at another version. A client refuses a handshake response at another version. A change to the wire
 *  requires a higher version. rpc-wire.test.ts compares the wire's shape with the shape recorded for this version. */
export const RPC_PROTOCOL = 3;

/** What every call's envelope holds. */
export const RpcEnvelopeSchema = z.object({
	jsonrpc: z.literal("2.0"),
	protocol: z.literal(RPC_PROTOCOL),
	id: z.string(),
	/** The step's arguments. A call to a step without arguments states an empty record. */
	params: z.record(z.string(), z.unknown()),
	capability: z.string().optional(),
	stream: z.boolean().optional(),
	/** The caller's seqPath. The server dispatches the step at this seqPath. It allocates a synthetic seqPath where the call's seqPath is absent or empty. */
	seqPath: z.array(z.number()).optional(),
	/** The access level at which the caller reads. A server bounds the call to the narrower of this level and its own ceiling.
	 *  A caller can read at a narrower level than it holds and can't read at a wider one. */
	readingAt: AccessLevelSchema.optional(),
	/** Whether the call requests a read or an action. A read doesn't leave a record in actuality. A server refuses a read
	 *  of a method that doesn't declare itself a read. A call that doesn't state `asks` requests an action. */
	asks: z.enum(["read", "act"]).optional(),
	method: z.string(),
});

/** Incoming JSON-RPC 2.0 request (POST /rpc/:method): the handshake, or a call that states `actualityId`. The
 *  `actualityId` names the actuality whose records the call reads. */
export const rpcRequestSchema = (actualityId: z.ZodType<TActualityId>) =>
	z.union([RpcEnvelopeSchema.extend({ method: z.literal(ACTION_BEGIN) }), RpcEnvelopeSchema.extend({ actualityId })], {
		// Reports the first issue of the last branch. That branch parses every call except the handshake.
		error: (issue) => issue.errors?.at(-1)?.[0]?.message,
	});
export const RpcRequestSchema = rpcRequestSchema(ActualityIdSchema);
type TRpcRequest = z.infer<typeof RpcRequestSchema>;

/** The body of a host's handshake response. */
export const HandshakeSchema = z.object({ protocol: z.literal(RPC_PROTOCOL), hostId: z.number(), site: z.string().min(1), actualityId: ActualityIdSchema, serving: z.boolean() });
export type THandshake = z.infer<typeof HandshakeSchema>;

/** What the person can do about a refused call or a refused step. A page offers each remedy as a control. `sign-in` holds
 *  the URL of the site where the person signs in. That site responded in front of the instance. `reload` names what the
 *  caller reads again: the client, the actuality or the authority. A client older than the instance reloads itself. A
 *  caller that read an earlier actuality reads the instance's actuality again. A caller whose presented authority failed
 *  verification reads what its key holds again. Authority that was revoked or has lapsed fails verification. `request`
 *  names the action a caller lacks, which it requests from a key that delegates it. `open` names a reference to open in
 *  place of what was refused, such as the collection of a type whose record actuality doesn't hold. */
export const RemedySchema = z.discriminatedUnion("do", [
	z.object({ do: z.literal("sign-in"), at: z.url() }),
	z.object({ do: z.literal("reload"), what: z.enum(["client", "actuality", "authority"]) }),
	z.object({ do: z.literal("request"), action: z.string().min(1) }),
	z.object({ do: z.literal("open"), ref: z.object({ kind: z.string().min(1), target: z.record(z.string(), z.unknown()) }) }),
]);
export type TRemedy = z.infer<typeof RemedySchema>;

/** The remedies that reload, by what they read again. */
export const RELOAD = {
	client: { do: "reload", what: "client" },
	actuality: { do: "reload", what: "actuality" },
	authority: { do: "reload", what: "authority" },
} as const satisfies Record<string, TRemedy>;

/** Formats a version for a refusal message. */
const versionSaid = (version: unknown) => (typeof version === "number" ? `version ${version}` : "a version from before versions were stated");

/** Returns the refusal for a client at RPC protocol `client` and an instance at `instance`, or undefined where the
 *  versions match. A side that doesn't state a version is the older one. An older client's remedy is a reload. The
 *  reload loads the client's installed build. The refusal of an older instance doesn't carry a remedy, since the instance
 *  is updated where it is deployed. */
export function protocolRefusal(client: unknown, instance: unknown): TRpcRefusal | undefined {
	if (client === instance) return undefined;
	const clientOlder = typeof client !== "number" || (typeof instance === "number" && client < instance);
	const older = clientOlder ? "This client is older than the instance" : "The instance is older than this client";
	return {
		error: `${older}. The client's RPC protocol is ${versionSaid(client)}. The instance's RPC protocol is ${versionSaid(instance)}.`,
		remedy: clientOlder ? RELOAD.client : undefined,
	};
}

/** Returns a host's refusal of a call that reads actuality `stated`. The host holds actuality `held`. Returns undefined
 *  where the call states `held` or doesn't state an actuality. A different actuality means the instance replaced its
 *  records after the caller read them, such as on a restart. The remedy reads the instance's actuality again. */
export function actualityRefusal(stated: unknown, held: TActualityId): TRpcRefusal | undefined {
	if (stated === held || stated === undefined) return undefined;
	return { error: `This instance holds actuality ${held}. The call reads actuality ${String(stated)}. This instance doesn't hold that actuality.`, remedy: RELOAD.actuality };
}

/** Matches only the host's `actualityId`. A call that states another actualityId fails with the actuality refusal's
 *  message. A call that doesn't state one fails to parse. */
const heldActuality = (actualityId: TActualityId) => z.literal(actualityId, { error: ({ input }) => actualityRefusal(input, actualityId)?.error });

/** The result of a call whose step succeeded without products. A caller reads the step's declaration to determine whether
 *  the step returns products. This result doesn't state that. */
export const ANSWERED_WITHOUT_PRODUCTS = { ok: true } as const;

/** One method of an `/rpc` method family. `action` names the action a caller must invoke. `handle` computes the call's result. */
export type TRpcMethod = { action: string; handle: (params: Record<string, unknown>) => Promise<unknown> };

/** Outgoing JSON-RPC 2.0 response to client. */
export const RpcResponseSchema = z.object({ jsonrpc: z.literal("2.0"), id: z.string(), result: z.unknown().optional(), error: z.string().optional() });
/** Outgoing JSON-RPC 2.0 stream chunk to client. */
export const RpcStreamSchema = z.object({ jsonrpc: z.literal("2.0"), id: z.string(), stream: z.literal(true), data: z.unknown() });
/** A host's response to a call it didn't serve. `error` states why. `remedy` states what the person can do, where a remedy exists. */
export const RpcRefusalSchema = z.object({ error: z.string().min(1), remedy: RemedySchema.optional() });
export type TRpcRefusal = z.infer<typeof RpcRefusalSchema>;

/** A host's response to a call: its body, or its refusal. */
type TRpcAnswer = { kind: "answered"; body: unknown } | ({ kind: "refused" } & TRpcRefusal);

/** Formats a remedy as text for a place that can't offer it as a control, such as a log. */
export function remedySaid(remedy: TRemedy): string {
	if (remedy.do === "sign-in") return `sign in at ${remedy.at}`;
	if (remedy.do === "request") return `request ${remedy.action} from a key that delegates it`;
	if (remedy.do === "open") return `open the ${remedy.ref.kind} ${JSON.stringify(remedy.ref.target)}`;
	return remedy.what === "client" ? "reload the client" : `read the ${remedy.what} again`;
}

/** A refusal as a place that can't offer its remedy as a control states it: its cause, then its remedy in words. */
export const refusalSaid = ({ error, remedy }: TRpcRefusal): string => (remedy === undefined ? error : `${error} (${remedySaid(remedy)})`);

const REFUSED_CALL = "RefusedCall";

/** The error of a refused call. It carries the refusal, so the code that shows it can offer the remedy as a control. */
export class RefusedCall extends Error {
	readonly refusal: TRpcRefusal;
	/** Takes a refusal or a refused response and keeps its reason and remedy. The message appends the remedy as text. */
	constructor({ error, remedy }: TRpcRefusal) {
		super(refusalSaid({ error, remedy }));
		this.name = REFUSED_CALL;
		this.refusal = { error, remedy };
	}
}

const RefusedCallSchema = z.object({ name: z.literal(REFUSED_CALL), refusal: RpcRefusalSchema });
/** Returns the refusal a failure carries where the failure is a refused call. It matches the failure by its name because
 *  each page bundle holds its own copy of the class. */
export const refusalCarried = (err: unknown): TRpcRefusal | undefined => RefusedCallSchema.safeParse(err).data?.refusal;

/** Whether a refusal reports presented authority that failed verification. */
export const authorityFailed = (refusal: TRpcRefusal | undefined): boolean => refusal?.remedy?.do === "reload" && refusal.remedy.what === RELOAD.authority.what;

/** The HTTP status of a refused request whose presented authority fails verification. It is 403 because a 401 requests
 *  HTTP authentication (RFC 9110 §15.5.2). A browser that receives a 401 drops the sign-in it sent for the site. That
 *  sign-in can be a proxy's basic auth. The proxy in front of the instance then refuses each later call to the site. */
export const REFUSED_INVOCATION = 403;

/** The HTTP status of a call its handler or the gate refused: 422, Unprocessable Content. */
export const REFUSED_CALL_STATUS = 422;

/** Returns the refusal of a call whose presented authority failed verification. Its remedy reads what the key holds again. */
export const authorityRefusal = (error: string): TRpcRefusal => ({ error, remedy: RELOAD.authority });

/** Returns the refusal of a call that failed. The error names the method, so a page shows which call failed. */
export const callFailed = (method: string, failure: string, remedy?: TRemedy): TRpcRefusal => ({ error: `${method}: ${failure}`, ...(remedy === undefined ? {} : { remedy }) });

/** Returns the refusal of a call whose response didn't come from actuality. Actuality responds to every call with JSON, so
 *  a response of another media type came from a proxy or server in front of it. The remedy of a 401 or 407 status signs
 *  in at `site` where the caller passes it. */
export function notFromActuality(method: string, status: number, mediaType: string, answered: string, site?: string): TRpcRefusal {
	const error = `${method}: this call didn't reach actuality. A proxy or server in front of actuality responded with ${status} (${mediaType}): ${answered.trim()}.`;
	return { error, remedy: site && (status === 401 || status === 407) ? { do: "sign-in", at: site } : undefined };
}

/** How a refusal names the media type of a response whose headers don't state one. */
const UNSTATED_MEDIA_TYPE = "a body that doesn't state its media type";

/**
 * Reads a host's response to a call by the media type the response states. A host responds to every call with JSON. The
 * response to a served call holds its result. The response to a call the host didn't serve holds its refusal and an
 * error status. A response of another media type didn't come from the host's RPC. A server responds with text to a path
 * it doesn't serve, for example. Such a response becomes a refusal that holds its status and the start of its body.
 */
export async function readRpcAnswer(method: string, res: Response): Promise<TRpcAnswer> {
	const mediaType = res.headers.get("content-type");
	if (mediaType === null || !mediaType.startsWith("application/json")) {
		const site = URL.canParse(res.url) ? new URL(res.url).origin : undefined;
		const stated = mediaType === null ? UNSTATED_MEDIA_TYPE : mediaType;
		return { kind: "refused", ...notFromActuality(method, res.status, stated, (await res.text()).slice(0, 200), site) };
	}
	const body: unknown = await res.json();
	return res.ok ? { kind: "answered", body } : { kind: "refused", ...RpcRefusalSchema.parse(body) };
}

/** Returns the body of a host's response to a call. Throws a RefusedCall where the response is a refusal. */
export async function answerBody(method: string, res: Response): Promise<unknown> {
	const answer = await readRpcAnswer(method, res);
	if (answer.kind === "refused") throw new RefusedCall(answer);
	return answer.body;
}

/** The method, protocol version and actualityId a call states. They are parsed before the rest of the call, so a refusal
 *  of the version or the actuality carries its remedy. */
export const StatedSchema = z.object({ method: z.unknown(), protocol: z.unknown(), actualityId: z.unknown() }).partial().loose();

/** Parses an incoming RPC request for a host that holds actuality `actualityId`. Returns the request, or a refusal with
 *  its remedy where one exists. */
export function parseRpcRequest(raw: unknown, actualityId: TActualityId): { success: true; data: TRpcRequest } | { success: false; refusal: TRpcRefusal } {
	// A call at another protocol version is refused for its version before the rest of the call is parsed.
	const stated = StatedSchema.safeParse(raw).data;
	const otherProtocol = protocolRefusal(stated?.protocol, RPC_PROTOCOL);
	if (otherProtocol) return { success: false, refusal: otherProtocol };
	// The schema is built once per held actuality. The held actuality changes only when the host's records are replaced.
	if (held?.actualityId !== actualityId) held = { actualityId, schema: rpcRequestSchema(heldActuality(actualityId)) };
	const parsed = held.schema.safeParse(raw);
	if (parsed.success) return { success: true, data: parsed.data };
	const notHeld = stated?.method === ACTION_BEGIN ? undefined : actualityRefusal(stated?.actualityId, actualityId);
	if (notHeld) return { success: false, refusal: notHeld };
	return { success: false, refusal: { error: z.prettifyError(parsed.error) } };
}
let held: { actualityId: TActualityId; schema: ReturnType<typeof rpcRequestSchema> } | undefined;

/** Serializes a JSON-RPC request body in the shape the server parses. JSON.stringify drops undefined fields, so the body holds only the fields the caller stated. */
export function rpcEnvelope(e: TRpcEnvelope): string {
	return JSON.stringify({ jsonrpc: "2.0", protocol: RPC_PROTOCOL, ...e });
}

/** Computes the headers that prove a call. It reads the request as it is sent: its URL, method, headers and body. */
export type TProveRequest = (request: { url: string; method: string; headers: Record<string, string>; body: string }) => Promise<Record<string, string>>;

/** The fields of a call's envelope that its caller states, as the schema reads them. `rpcEnvelope` adds `jsonrpc` and `protocol`. */
export type TRpcEnvelope = z.input<typeof RpcRequestSchema> extends infer R ? (R extends unknown ? Omit<R, "jsonrpc" | "protocol"> : never) : never;

/** The fetch credentials mode under which a browser sends its sign-in for the target site with each call. That sign-in
 *  can be a proxy's basic auth. The call carries its own proof beside it. A page on the same site sends that sign-in
 *  under the default mode. An extension calls from another origin. A browser sends a sign-in to another origin only
 *  under `include`. A process sends the sign-in that `holdSignIn` stores. This mode doesn't change a process's request. */
export const WITH_THE_SITES_SIGN_IN = "include" satisfies RequestCredentials;

/** A call as it is sent: its URL, and the POST that holds its envelope and the headers computed over it. */
export type TRpcCall = { url: string; init: { method: "POST"; headers: Record<string, string>; body: string; credentials: typeof WITH_THE_SITES_SIGN_IN } };

/** Returns a request's headers unchanged, for a call that doesn't invoke an action. */
export const provesNothing: TProveRequest = (request) => Promise.resolve(request.headers);

/**
 * Reads an NDJSON body and yields one JSON object per line. A partial line is buffered until the rest of it arrives. The
 * last line is yielded whether or not it ends in a newline.
 *
 * It throws on a malformed line. JSON.stringify writes every line on this wire, so a line that doesn't parse came from
 * another writer. Skipping it would drop part of a response without an error.
 */
export async function* readNdjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T, void, unknown> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const parse = (line: string): T => {
		try {
			return JSON.parse(line) as T;
		} catch {
			throw new Error(`stream carried a line that is not JSON: ${line.slice(0, 200)}`);
		}
	};
	let buffer = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let idx = buffer.indexOf("\n");
			while (idx !== -1) {
				const line = buffer.slice(0, idx).trim();
				buffer = buffer.slice(idx + 1);
				if (line.length > 0) yield parse(line);
				idx = buffer.indexOf("\n");
			}
		}
		const tail = buffer.trim();
		if (tail.length > 0) yield parse(tail);
	} finally {
		try {
			await reader.cancel();
		} catch {
			/* already closed */
		}
	}
}

const SERVER_UNREACHABLE = "ServerUnreachable";

/**
 * A failure to reach a haibun host: the request didn't receive a response, so what it requested is unknown. A caller
 * reports it as the deployment's state (the reader is offline, or the host stopped). Every other failure, including an
 * error the host returns, is a fault.
 */
export class ServerUnreachable extends Error {
	constructor(
		readonly url: string,
		cause: unknown,
	) {
		super(`the server did not respond to ${url}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
		this.name = SERVER_UNREACHABLE;
	}
}

/** How deep in a failure's causes `isServerUnreachable` reads. */
const CAUSE_DEPTH = 8;

/** Whether a failure, or one of its causes, is a failure to reach a host. It reads the failure's name, since each bundle of
 *  a page holds its own copy of the class. */
export function isServerUnreachable(err: unknown): boolean {
	for (let e: unknown = err, depth = 0; e && depth < CAUSE_DEPTH; e = (e as { cause?: unknown }).cause, depth++)
		if ((e as { name?: unknown }).name === SERVER_UNREACHABLE) return true;
	return false;
}

/** A call to a remote host's step: its result where the host served it, or the reason it failed, which names the step and
 *  the host. */
export type TRemoteCall = { served: true; result: unknown } | { served: false; reason: string };

/** A remote host's steps as a proxy calls them: the handshake that begins the surface, and each step's call, signed for
 *  the action it invokes where it invokes one. */
export type TRemoteSteps = {
	handshake(): Promise<THandshake>;
	call(method: string, params: Record<string, unknown>, seqPath: number[], action: string | undefined): Promise<TRemoteCall>;
};
