/**
 * The JSON-RPC wire every caller of a haibun host speaks: the request envelope, and the reader for a streamed answer.
 *
 * Separate from rpc-client because the browser conduit sends the same envelopes and reads the same streams, while
 * rpc-client reaches node-only capability context. One home for the wire means a field added to the envelope reaches
 * the browser and the server callers together, rather than to whichever one was remembered.
 */
import { z } from "zod";
import { AccessLevelSchema } from "./resources.js";

/** Incoming JSON-RPC 2.0 request from client (POST /rpc/:method). */
export const RpcRequestSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.string(),
	method: z.string(),
	params: z.record(z.string(), z.unknown()).optional().default({}),
	capability: z.string().optional(),
	stream: z.boolean().optional(),
	/** Caller's seqPath for threading hierarchical step identity through RPC. */
	seqPath: z.array(z.number()).optional(),
	/** The most this caller may see. A server bounds a call to the narrower of this and its own ceiling, so a caller
	 *  can ask to see less than it is allowed but never more. */
	readingAt: AccessLevelSchema.optional(),
	/** What the caller asks of the run: to be answered, or to act. A call asking to read is answered and leaves no
	 *  record of the reading, and is refused where the step does not declare itself a read. A call that states nothing
	 *  asks the run to act, which is what a caller that knows nothing of this can only be doing. */
	asks: z.enum(["read", "act"]).optional(),
});
export type TRpcRequest = z.infer<typeof RpcRequestSchema>;

/** Outgoing JSON-RPC 2.0 response to client. */
export const RpcResponseSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.string(),
	result: z.unknown().optional(),
	error: z.string().optional(),
});
export type TRpcResponse = z.infer<typeof RpcResponseSchema>;

/** Outgoing JSON-RPC 2.0 stream chunk to client. */
export const RpcStreamSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.string(),
	stream: z.literal(true),
	data: z.unknown(),
});
export type TRpcStream = z.infer<typeof RpcStreamSchema>;

/**
 * Parse and validate an incoming RPC request.
 * Returns the parsed request or null if the message is not an RPC request.
 */
export function parseRpcRequest(raw: unknown): TRpcRequest | null {
	const result = RpcRequestSchema.safeParse(raw);
	return result.success ? result.data : null;
}

/** A JSON-RPC request body, ready to send: the same shape the server parses. Undefined fields are dropped, so an envelope carries only what its caller stated. */
export function rpcEnvelope(e: Omit<TRpcRequest, "jsonrpc" | "params"> & { params: Record<string, unknown> }): string {
	return JSON.stringify({ jsonrpc: "2.0", ...e });
}

/**
 * Read an NDJSON body: one JSON object per line, a partial line held until its rest arrives, the last line yielded
 * whether or not it ends in a newline.
 *
 * A malformed line throws. Every line on this wire is written by JSON.stringify, so a line that will not parse is
 * something else writing into the response, and a dropped line is a chunk of an answer missing with nothing said.
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
