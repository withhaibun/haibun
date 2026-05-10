import diagnostics_channel from "node:diagnostics_channel";
import { AsyncLocalStorage } from "node:async_hooks";

import { HttpTraceArtifact } from "../schema/protocol.js";
import type { TWorld } from "./world.js";
import type { TTag } from "./ttag.js";
import { trackHttpHost } from "./http-observations.js";

export interface TStepTrace {
	world: TWorld;
	tag: TTag;
	stepperName: string;
}

export const stepTraceStorage = new AsyncLocalStorage<TStepTrace>();

interface UndiciRequest {
	origin?: string;
	path?: string;
	method?: string;
	headers?: string[] | Record<string, string>;
	_haibun_step_trace?: TStepTrace;
	_haibun_start?: number;
	_haibun_chunks?: Buffer[];
}

interface UndiciResponse {
	statusCode?: number;
	headers?: string[] | Record<string, string>;
	_haibun_chunks?: Buffer[];
}

/**
 * Convert undici headers (array of [key, value, key, value, ...]) to Record
 */
function headersToRecord(headers: string[] | Record<string, string> | undefined): Record<string, string> | undefined {
	if (!headers) return undefined;
	if (!Array.isArray(headers)) return headers;

	const record: Record<string, string> = {};
	for (let i = 0; i < headers.length; i += 2) {
		const key = headers[i];
		const value = headers[i + 1];
		if (key && value) {
			record[key.toLowerCase()] = value;
		}
	}
	return record;
}

export class NodeHttpEvents {
	private static isInitialized = false;

	public static init(): void {
		if (this.isInitialized) return;

		// 1. Request Lifecycle
		diagnostics_channel.channel("undici:request:create").subscribe((message: unknown) => {
			const { request } = message as { request: UndiciRequest };
			const stepTrace = stepTraceStorage.getStore();
			if (!stepTrace) return;

			request._haibun_step_trace = stepTrace;
			request._haibun_start = Date.now();
			request._haibun_chunks = [];

			this.emitTrace("request", request);
		});

		// Intercept request body chunks
		diagnostics_channel.channel("undici:request:bodySent").subscribe((message: unknown) => {
			const { request, chunk } = message as { request: UndiciRequest; chunk: Buffer };
			if (request._haibun_step_trace && chunk) {
				if (!request._haibun_chunks) request._haibun_chunks = [];
				request._haibun_chunks.push(chunk);
			}
		});

		// 2. Response Lifecycle
		diagnostics_channel.channel("undici:request:headers").subscribe((message: unknown) => {
			const { request, response } = message as { request: UndiciRequest; response: UndiciResponse };
			if (!request._haibun_step_trace) return;

			response._haibun_chunks = [];
		});

		// Buffer response body chunks
		diagnostics_channel.channel("undici:response:bodyReceived").subscribe((message: unknown) => {
			const { response, chunk } = message as { response: UndiciResponse; chunk: Buffer };
			if (response._haibun_chunks && chunk) {
				response._haibun_chunks.push(chunk);
			}
		});

		// Emit on completion
		diagnostics_channel.channel("undici:request:trailers").subscribe((message: unknown) => {
			const { request, response } = message as { request: UndiciRequest; response: UndiciResponse };
			if (request._haibun_step_trace) {
				this.emitTrace("response", request, response);
			}
		});

		this.isInitialized = true;
	}

	private static emitTrace(event: "request" | "response", request: UndiciRequest, response?: UndiciResponse): void {
		const stepTrace = request._haibun_step_trace as TStepTrace;
		if (!stepTrace) return;

		const { world, stepperName } = stepTrace;

		const rawBody = event === "request" ? Buffer.concat(request._haibun_chunks || []).toString("utf8") : Buffer.concat(response?._haibun_chunks || []).toString("utf8");

		const url = `${request.origin || ""}${request.path || ""}`;

		// fire-and-forget: in-memory QuadStore resolves synchronously
		void trackHttpHost(world, url);

		const artifact = HttpTraceArtifact.parse({
			id: `http-trace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
			timestamp: Date.now(),
			kind: "artifact",
			artifactType: "http-trace",
			level: "debug",
			httpEvent: event,
			trace: {
				requestingPage: `stepper://${stepperName}`,
				requestingURL: url, // The actual target URL for sequence diagram
				method: request.method,
				status: response?.statusCode,
				headers: event === "request" ? headersToRecord(request.headers) : headersToRecord(response?.headers),
				postData: event === "request" ? this.tryDecode(rawBody) : undefined,
			},
		});

		world.eventLogger.emit(artifact);
	}

	private static tryDecode(body: string): unknown {
		if (!body) return undefined;
		try {
			// Handle JSON (DID Docs, JWKS)
			if (body.startsWith("{") || body.startsWith("[")) {
				return JSON.parse(body);
			}

			// Handle JWT / SD-JWT (Compact Serialization)
			const parts = body.split(".");
			if (parts.length >= 2) {
				return {
					header: JSON.parse(Buffer.from(parts[0], "base64url").toString()),
					payload: JSON.parse(Buffer.from(parts[1], "base64url").toString()),
					isSDJWT: body.includes("~"),
				};
			}
		} catch {
			return { raw: body.slice(0, 200), note: "could not decode" };
		}
		return body;
	}
}
