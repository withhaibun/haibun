import { errorDetail } from "@haibun/core/lib/util/index.js";
import { conduit } from "./hypermedia.js";
import { getAvailableSteps, requireStep, carriedProducts } from "./rpc-registry.js";
import { appAccessLevel } from "./util.js";
import { queryGraph } from "./quads-snapshot.js";

export type FetchOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** Step discovery + action scope + RPC + error detail in one call. Callers own their loading/error UI. The wire call routes through the installed `Conduit` so live/serialized/test modes share one path. `step` is a friendly name or full `Stepper-method`, resolved against the loaded registry at runtime. */
export async function callStep<T>(step: string, params: Record<string, unknown> = {}, why?: string): Promise<FetchOutcome<T>> {
	try {
		await getAvailableSteps();
		const method = requireStep(step);
		// A page carrying a run holds what its views showed, which is the answer here: the step took no arguments, so
		// what it produced then is what it produces now, and there is no server to ask.
		const carried = Object.keys(params).length === 0 ? carriedProducts(method) : undefined;
		if (carried !== undefined) return { ok: true, value: carried as T };
		const value = await conduit().follow<T>({ method, params }, why ?? `pane-fetch: ${step}`);
		return { ok: true, value };
	} catch (err) {
		return { ok: false, error: errorDetail(err) };
	}
}

/** A bounded slice of a type's individuals, at the caller's app access level — the query a type view and the class
 *  browser both list from, through the one graph query, so with no server it lists what the page caches. Callers own
 *  their loading/error UI. */
export async function fetchIndividuals(label: string, why: string): Promise<FetchOutcome<{ vertices: Record<string, unknown>[] }>> {
	try {
		return { ok: true, value: await queryGraph({ label, accessLevel: appAccessLevel(), limit: 100 }) };
	} catch (err) {
		return { ok: false, error: `${why}: ${errorDetail(err)}` };
	}
}
