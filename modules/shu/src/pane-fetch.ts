import { inAction, SseClient } from "./sse-client.js";
import { getAvailableSteps, requireStep } from "./rpc-registry.js";
import { errMsg } from "./util.js";

export type FetchOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Shared pane RPC: ensures step discovery, opens an action scope, calls the
 * named step, and returns a discriminated outcome. Callers own their own
 * loading/error UI state — the helper just collapses the inAction + try/catch
 * + errMsg pattern into one call so every pane surfaces failures the same way.
 * No new server routes; uses the existing step registry.
 */
export async function callStep<T>(step: string, params: Record<string, unknown> = {}, why?: string): Promise<FetchOutcome<T>> {
	try {
		await getAvailableSteps();
		const value = await inAction((scope) => SseClient.for("").rpc<T>(scope, requireStep(step), params), why);
		return { ok: true, value };
	} catch (err) {
		return { ok: false, error: errMsg(err) };
	}
}
