import { inAction, SseClient } from "./sse-client.js";
import { getAvailableSteps, requireStep } from "./rpc-registry.js";
import { errMsg } from "./util.js";

export type FetchOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** Step discovery + action scope + RPC + errMsg in one call. Callers own their loading/error UI. */
export async function callStep<T>(step: string, params: Record<string, unknown> = {}, why?: string): Promise<FetchOutcome<T>> {
	try {
		await getAvailableSteps();
		const value = await inAction((scope) => SseClient.for("").rpc<T>(scope, requireStep(step), params), why);
		return { ok: true, value };
	} catch (err) {
		return { ok: false, error: errMsg(err) };
	}
}
