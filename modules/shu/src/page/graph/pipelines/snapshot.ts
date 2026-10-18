/**
 * The read of a scope's graph snapshot: the site's clustered sample of each type, with the true totals and an "+N more"
 * cluster per type, held per scope and extended by the live stream. Where the site doesn't respond, the graph the page
 * holds returns the sample, its totals and its clusters as the site would have.
 */
import type { QuadGraphModel } from "@haibun/core/lib/derivations/quad-graph-model.js";
import type { AccessLevel } from "@haibun/core/lib/domains/resources.js";
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import * as Steps from "../../derivations/steps.js";
import { reads } from "../../domains/links.js";
import type { TStepList } from "../../machines/registry.js";
import type { TConduit } from "../../ports.js";
import type { TCachedGraph } from "../../client-cache/ports.js";
import type { SnapshotStore } from "../machines/snapshot-store.js";
import type { TGraphSnapshot, TSnapshotKey } from "../domains/snapshot.js";

/** What a snapshot read reads: actuality's steps, the conduit, the graph the page serves from (which keeps what the site
 *  returns), the graph the page reads where the site doesn't respond, a fresh model for a limit, and the visibility ceiling. */
export type TSnapshotScope = {
	steps: () => Promise<TStepList>;
	conduit: () => TConduit;
	served: () => TCachedGraph;
	held: () => TCachedGraph;
	model: (perTypeLimit: number) => QuadGraphModel;
	accessLevel: AccessLevel;
};

/** What a view reads of a snapshot: its scope, the per-type limit, the types it shows, and whether it reads again what it holds. */
export type TSnapshotAsk = { scope: string; perTypeLimit: number; types: readonly string[] | undefined; again: boolean };

/** The key a snapshot is held under: its limit, its types in one order, and its ceiling. */
export const snapshotKey = (ask: TSnapshotAsk, accessLevel: string): TSnapshotKey => ({
	perTypeLimit: ask.perTypeLimit,
	types: ask.types === undefined || ask.types.length === 0 ? "*" : [...ask.types].sort().join(","),
	accessLevel,
});

/** Returns the snapshot `ask` names: the one its scope holds under the same key, unless the ask reads it again, else a new read. */
export function readSnapshot(scope: TSnapshotScope, store: SnapshotStore, ask: TSnapshotAsk): Promise<TGraphSnapshot> {
	const key = snapshotKey(ask, scope.accessLevel);
	const held = store.heldUnder(ask.scope, key);
	if (!ask.again && held !== undefined) return Promise.resolve(held);
	store.forget(ask.scope);
	return read(scope, store, ask, key);
}

async function read(scope: TSnapshotScope, store: SnapshotStore, ask: TSnapshotAsk, key: TSnapshotKey): Promise<TGraphSnapshot> {
	const priorPinned = store.pinned(ask.scope);
	const model = scope.model(ask.perTypeLimit);
	const types = ask.types === undefined ? undefined : [...ask.types];
	let clustered: { quads: TQuad[]; clusters: TCluster[]; site?: string };
	try {
		const list = await scope.steps();
		clustered = await scope
			.conduit()
			.follow<{ quads: TQuad[]; clusters: TCluster[]; site?: string }>(
				reads(Steps.methodOf(list, "getClusteredQuads"), { perTypeLimit: ask.perTypeLimit, types, accessLevel: scope.accessLevel }),
				"the graph's clustered sample",
			);
		if (!Array.isArray(clustered.quads)) throw new Error("getClusteredQuads returned quads that aren't a list");
		void scope.served().setMany(clustered.quads); // the page keeps what the site returned, for a later read without the site
	} catch (err) {
		clustered = await scope.held().getClusteredQuads({ perTypeLimit: ask.perTypeLimit, types, accessLevel: scope.accessLevel });
		if (clustered.quads.length === 0) throw err;
	}
	model.seed({ quads: clustered.quads, clusters: clustered.clusters, site: clustered.site });
	if (priorPinned !== undefined) model.pin(priorPinned);
	store.adopt(ask.scope, model, key);
	return model.snapshot;
}
