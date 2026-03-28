import type { TSeqPath } from "@haibun/core/schema/protocol.js";
import type { StepRegistry } from "@haibun/core/lib/step-dispatch.js";
import type { IWebServer } from "./defs.js";

/**
 * A single RPC dispatch request — the universal unit of step execution.
 * seqPath is always required; capability is checked before dispatch.
 * All execution paths (in-process, subprocess, SPA, MCP) use this shape.
 */
export type StepRpcRequest = {
	method: string;
	params: Record<string, unknown>;
	seqPath: TSeqPath;
	/** Optional capability label for permission gating. Transport checks before dispatching. */
	capability?: string;
};

export type StepRpcResponse =
	| { ok: true; products: Record<string, unknown> }
	| { ok: false; error: string };

/**
 * Pluggable transport abstraction.
 * SSE, MCP, subprocess, and future transports all implement this interface.
 * attach() registers routes/handlers; detach() tears them down on endFeature.
 */
export interface IStepTransport {
	readonly name: string;
	attach(registry: StepRegistry, webserver: IWebServer): void;
	detach(): void;
}
