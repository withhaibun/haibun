/**
 * The JSON-RPC wire every caller of a haibun host speaks: the request envelope, and the reader for a streamed answer.
 *
 * Separate from rpc-client because the browser conduit sends the same envelopes and reads the same streams, while
 * rpc-client reaches node-only capability context. One home for the wire means a field added to the envelope reaches
 * the browser and the server callers together, rather than to whichever one was remembered.
 */
import { stripTrailingSlash } from "./local-origin.js";
import { z } from "zod";
import { AccessLevelSchema } from "./resources.js";
import { basicAuthorization, type TBasicAuthUser } from "./basic-auth.js";

/** The actuality a host's records belong to: new when its records start, and kept with the records a store keeps. */
export const ActualityIdSchema = z.uuid();
export type TActualityId = z.infer<typeof ActualityIdSchema>;
/** A new actualityId, for records that start empty. */
export const newActualityId = (): TActualityId => crypto.randomUUID();

/** Where a host answers calls, by method. */
export const RPC_ROUTE = "/rpc/";

/** Where actuality's events are streamed to a follower. */
export const SSE_ROUTE = "/sse";

/** The header a follower of actuality's events states the actualityId it follows in. */
export const ACTUALITY_HEADER = "actuality-id";

/** The handshake, answered with the host's hostId, site and the actualityId every other call states. */
export const ACTION_BEGIN = "action.begin";

/** What every call's envelope holds. */
export const RpcEnvelopeSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.string(),
	params: z.record(z.string(), z.unknown()).optional().default({}),
	capability: z.string().optional(),
	stream: z.boolean().optional(),
	/** Caller's seqPath for threading hierarchical step identity through RPC. */
	seqPath: z.array(z.number()).optional(),
	/** The most this caller may see. A server bounds a call to the narrower of this and its own ceiling, so a caller
	 *  can ask to see less than it is allowed but never more. */
	readingAt: AccessLevelSchema.optional(),
	/** What the caller asks of actuality: to be answered, or to act. A call asking to read is answered and doesn't leave a
	 *  record of the reading, and is refused where the step does not declare itself a read. A call that doesn't state it
	 *  asks actuality to act, which is what a caller that doesn't send this field can only be doing. */
	asks: z.enum(["read", "act"]).optional(),
	method: z.string(),
});

/** Incoming JSON-RPC 2.0 request (POST /rpc/:method): the handshake, or a call stating `actualityId`, the actuality whose
 *  records it reads. */
export const rpcRequestSchema = (actualityId: z.ZodType<TActualityId>) =>
	z.union([RpcEnvelopeSchema.extend({ method: z.literal(ACTION_BEGIN) }), RpcEnvelopeSchema.extend({ actualityId })], {
		// What a call that isn't the handshake failed on is what its caller is told.
		error: (issue) => issue.errors?.at(-1)?.[0]?.message,
	});
export const RpcRequestSchema = rpcRequestSchema(ActualityIdSchema);
type TRpcRequest = z.infer<typeof RpcRequestSchema>;

/** What a host answers the handshake with. */
export const HandshakeSchema = z.object({ hostId: z.number(), site: z.string().min(1), actualityId: ActualityIdSchema, serving: z.boolean() });
export type THandshake = z.infer<typeof HandshakeSchema>;

/** What the person can do about a refused call, which a page offers as a control: sign in at the site that answered in
 *  front of the instance, or reload, which reads what the instance holds now. A client older than the instance reloads
 *  itself, a caller that read an earlier actuality reads the instance's actuality again, and a caller whose presented
 *  authority failed verification, as one revoked or lapsed, reads again what its key holds. */
export const RemedySchema = z.discriminatedUnion("do", [
	z.object({ do: z.literal("sign-in"), at: z.url() }),
	z.object({ do: z.literal("reload"), what: z.enum(["client", "actuality", "authority"]) }),
]);
export type TRemedy = z.infer<typeof RemedySchema>;

/** The remedies that reload, by what they read again. */
export const RELOAD = {
	client: { do: "reload", what: "client" },
	actuality: { do: "reload", what: "actuality" },
	authority: { do: "reload", what: "authority" },
} as const satisfies Record<string, TRemedy>;

/** Why a host whose records are of `held` refuses a call stating `stated`, and its remedy, where the call doesn't state that
 *  actuality. A call that doesn't state one comes from a client built before calls stated one. */
export function actualityRefusal(stated: unknown, held: TActualityId): TRpcRefusal | undefined {
	if (stated === held) return undefined;
	if (stated === undefined) return { error: "the call doesn't state the actuality whose records it reads, as a client older than this instance doesn't", remedy: RELOAD.client };
	return { error: `this instance holds actuality ${held}, and the call states ${String(stated)}, whose records it doesn't hold`, remedy: RELOAD.actuality };
}

/** The actualityId of a host whose records are of `actualityId`: a call that doesn't state it doesn't parse. */
const heldActuality = (actualityId: TActualityId) => z.literal(actualityId, { error: ({ input }) => actualityRefusal(input, actualityId)?.error });

/** What a call answers where its step succeeded without products. A caller reads the step's declaration, not this, to know
 *  whether it answers with products. */
export const ANSWERED_WITHOUT_PRODUCTS = { ok: true } as const;

/** One method of an `/rpc` method family: the action a caller must invoke, and what answers the call. */
export type TRpcMethod = { action: string; handle: (params: Record<string, unknown>) => Promise<unknown> };

/** Outgoing JSON-RPC 2.0 response to client. */
export const RpcResponseSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.string(),
	result: z.unknown().optional(),
	error: z.string().optional(),
});
/** Outgoing JSON-RPC 2.0 stream chunk to client. */
export const RpcStreamSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.string(),
	stream: z.literal(true),
	data: z.unknown(),
});
/** What a host answers a call it did not serve with: why, and what the person can do about it, where they can. */
export const RpcRefusalSchema = z.object({ error: z.string().min(1), remedy: RemedySchema.optional() });
export type TRpcRefusal = z.infer<typeof RpcRefusalSchema>;

/** A host's answer to a call: what it answered, or why it did not. */
type TRpcAnswer = { kind: "answered"; body: unknown } | ({ kind: "refused" } & TRpcRefusal);

/** How a remedy reads where it can't be offered as a control, such as in a log. */
const remedySaid = (remedy: TRemedy): string =>
	remedy.do === "sign-in" ? `sign in at ${remedy.at}` : remedy.what === "client" ? "reload the client" : `read the ${remedy.what} again`;

const REFUSED_CALL = "RefusedCall";

/** A call that was refused, carrying the refusal, so whoever shows it offers its remedy as a control. */
export class RefusedCall extends Error {
	readonly refusal: TRpcRefusal;
	/** Made from a refusal, or from an answer that refused, of which it keeps the reason and the remedy. */
	constructor({ error, remedy }: TRpcRefusal) {
		super(remedy ? `${error} (${remedySaid(remedy)})` : error);
		this.name = REFUSED_CALL;
		this.refusal = { error, remedy };
	}
}

const RefusedCallSchema = z.object({ name: z.literal(REFUSED_CALL), refusal: RpcRefusalSchema });
/** The refusal a failure carries, where it is a refused call. It is read by the failure's name, since each page bundle has
 *  its own copy of the class. */
export const refusalCarried = (err: unknown): TRpcRefusal | undefined => RefusedCallSchema.safeParse(err).data?.refusal;

/** Whether a refusal is of presented authority that failed verification. */
export const authorityFailed = (refusal: TRpcRefusal | undefined): boolean => refusal?.remedy?.do === "reload" && refusal.remedy.what === RELOAD.authority.what;

/** The status a request whose presented authority fails verification is refused with: 403, not 401. A 401 asks for HTTP
 *  authentication (RFC 9110 §15.5.2), and a browser that sent the sign-in it holds for the site, such as a proxy's basic
 *  auth, drops that sign-in on a 401, so each later call to the site would be refused in front of the instance. */
export const REFUSED_INVOCATION = 403;

/** The refusal of a call whose presented authority failed verification, whose remedy is to read again what the key holds. */
export const authorityRefusal = (error: string): TRpcRefusal => ({ error, remedy: RELOAD.authority });

/** The refusal of a call the answer to which didn't come from actuality: a call is always answered as JSON, so an answer
 *  of another type came from a proxy or server in front of it. A refused sign-in is remedied by signing in at the site
 *  that answered, where the answer states it. */
export function notFromActuality(method: string, status: number, mediaType: string, answered: string, site?: string): TRpcRefusal {
	const error = `${method}: this call didn't reach actuality. Something in front of it answered ${status} (${mediaType}): ${answered.trim()}.`;
	return { error, remedy: site && (status === 401 || status === 407) ? { do: "sign-in", at: site } : undefined };
}

/**
 * Read a host's answer to a call by the media type the answer states. A host answers every call it serves as JSON, and
 * one it did not serve with its refusal and a status that states so. An answer that is not JSON did not come from the
 * host's RPC, as a path a server does not serve answers as text, and is refused with its status and what it sent.
 */
export async function readRpcAnswer(method: string, res: Response): Promise<TRpcAnswer> {
	const mediaType = res.headers.get("content-type") ?? "a body that doesn't state its media type";
	if (!mediaType.startsWith("application/json")) {
		const site = URL.canParse(res.url) ? new URL(res.url).origin : undefined;
		return { kind: "refused", ...notFromActuality(method, res.status, mediaType, (await res.text()).slice(0, 200), site) };
	}
	const body: unknown = await res.json();
	return res.ok ? { kind: "answered", body } : { kind: "refused", ...RpcRefusalSchema.parse(body) };
}

/** What a host answered a call with, or the refusal it stated, thrown as a refused call. */
export async function answerBody(method: string, res: Response): Promise<unknown> {
	const answer = await readRpcAnswer(method, res);
	if (answer.kind === "refused") throw new RefusedCall(answer);
	return answer.body;
}

/** What a call states of the actuality it reads, read before the rest of it, so a refusal names the remedy. */
const StatedActualitySchema = z.object({ method: z.string(), actualityId: z.unknown() }).partial().loose();

/** Parse an incoming RPC request, by a host whose records are of `actualityId`, or refuse it with what a caller can do. */
export function parseRpcRequest(raw: unknown, actualityId: TActualityId): { success: true; data: TRpcRequest } | { success: false; refusal: TRpcRefusal } {
	// The schema is made once for the actuality a host holds, which changes only when its records are replaced.
	if (held?.actualityId !== actualityId) held = { actualityId, schema: rpcRequestSchema(heldActuality(actualityId)) };
	const parsed = held.schema.safeParse(raw);
	if (parsed.success) return { success: true, data: parsed.data };
	const stated = StatedActualitySchema.safeParse(raw).data;
	const remedy = stated?.method === ACTION_BEGIN ? undefined : actualityRefusal(stated?.actualityId, actualityId)?.remedy;
	return { success: false, refusal: { error: z.prettifyError(parsed.error), remedy } };
}
let held: { actualityId: TActualityId; schema: ReturnType<typeof rpcRequestSchema> } | undefined;

/** A JSON-RPC request body, ready to send: the same shape the server parses. Undefined fields are dropped, so an envelope carries only what its caller stated. */
export function rpcEnvelope(e: TRpcEnvelope): string {
	return JSON.stringify({ jsonrpc: "2.0", ...e });
}

/** The headers that prove a call, made over the request as it is sent: its address, method, headers and body. */
export type TProveRequest = (request: { url: string; method: string; headers: Record<string, string>; body: string }) => Promise<Record<string, string>>;

/** The fields of a call's envelope, as its caller states them. */
export type TRpcEnvelope = TRpcRequest extends infer R ? (R extends unknown ? Omit<R, "jsonrpc"> : never) : never;

/** A call carries the sign-in the browser holds for the site it is sent to, such as a proxy's basic auth, beside its own
 *  proof. A page sends its site's sign-in anyway. An extension calls from another origin, where a browser sends it only
 *  when asked. A process sends the sign-in it holds for the site (`holdSignIn`), and this setting doesn't change its
 *  request. */
export const WITH_THE_SITES_SIGN_IN = "include" satisfies RequestCredentials;

/** The sign-ins this process holds, by origin, as a browser holds one for a site a person signed in to: every call to that
 *  origin carries its sign-in beside the call's own proof, which the `Signature` header carries. */
const heldSignIns = new Map<string, Record<string, string>>();

/** Hold the sign-in the basic auth at `origin` asks for, so each call this process makes there signs in with it. */
export function holdSignIn(origin: string, user: TBasicAuthUser): void {
	heldSignIns.set(new URL(origin).origin, { authorization: basicAuthorization(user) });
}

/** Let go of the sign-in held for `origin`, once what answers there has ended. */
export function releaseSignIn(origin: string): void {
	heldSignIns.delete(new URL(origin).origin);
}

/** A call as it is sent: its address, and the POST carrying its envelope under the headers made over it. */
type TRpcCall = { url: string; init: { method: "POST"; headers: Record<string, string>; body: string; credentials: typeof WITH_THE_SITES_SIGN_IN } };

/** `provesNothing`: a call that doesn't invoke an action is sent with its headers as they are. */
export const provesNothing: TProveRequest = (request) => Promise.resolve(request.headers);

/**
 * A call to the `/rpc` of the host at `base`: its address, its envelope, and the headers `prove` makes over the request,
 * the request's `host` among them as the host receives it. Every caller builds its calls here, so what a signature
 * covers is the same whoever sends it, and each caller decides only how it sends: once, with retries, or held open.
 */
export async function buildRpcCall(base: string, envelope: TRpcEnvelope, prove: TProveRequest): Promise<TRpcCall> {
	const url = `${stripTrailingSlash(base)}${RPC_ROUTE}${encodeURIComponent(envelope.method)}`;
	const body = rpcEnvelope(envelope);
	const headers = { "content-type": "application/json", host: new URL(url).host };
	const signedIn = heldSignIns.get(new URL(url).origin);
	return { url, init: { method: "POST", headers: { ...(await prove({ url, method: "POST", headers, body })), ...signedIn }, body, credentials: WITH_THE_SITES_SIGN_IN } };
}

/** Post one call to `method` at the `/rpc` of the host at `base`, proven by `prove`. A streamed call is answered as NDJSON
 *  and ends when its `signal` aborts. */
export async function postRpc(
	base: string,
	actualityId: TActualityId,
	method: string,
	params: Record<string, unknown>,
	prove: TProveRequest,
	stream?: { signal: AbortSignal },
): Promise<Response> {
	const call = await buildRpcCall(base, { id: `${method}-${Date.now()}`, method, params, actualityId, ...(stream ? { stream: true } : {}) }, prove);
	return await fetch(call.url, { ...call.init, signal: stream?.signal });
}

/** What the host at `base` answers the handshake with. */
export async function handshakeAt(base: string, fetchImpl: typeof fetch = fetch): Promise<THandshake> {
	const call = await buildRpcCall(base, { id: `${ACTION_BEGIN}-${Date.now()}`, method: ACTION_BEGIN, params: {} }, provesNothing);
	return HandshakeSchema.parse(await answerBody(ACTION_BEGIN, await fetchImpl(call.url, call.init)));
}

/** The actualityId of the records the host at `base` holds. */
export const actualityAt = async (base: string): Promise<TActualityId> => (await handshakeAt(base)).actualityId;

/**
 * Read an NDJSON body: one JSON object per line, a partial line held until its rest arrives, the last line yielded
 * whether or not it ends in a newline.
 *
 * A malformed line throws. Every line on this wire is written by JSON.stringify, so a line that will not parse is
 * something else writing into the response, and a dropped line is a chunk of an answer missing without an error.
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
