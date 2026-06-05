import { conduit } from "./hypermedia.js";
import { getAvailableSteps, requireStep } from "./rpc-registry.js";
import { errMsg } from "./util.js";

export type FetchOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** Step discovery + action scope + RPC + errMsg in one call. Callers own their loading/error UI. The wire call routes through the installed `Conduit` so live/serialized/test modes share one path. `step` is a friendly name or full `Stepper-method`, resolved against the loaded registry at runtime. */
export async function callStep<T>(step: string, params: Record<string, unknown> = {}, why?: string): Promise<FetchOutcome<T>> {
	try {
		await getAvailableSteps();
		const value = await conduit().follow<T>({ method: requireStep(step), params }, why ?? `pane-fetch: ${step}`);
		return { ok: true, value };
	} catch (err) {
		return { ok: false, error: errMsg(err) };
	}
}
