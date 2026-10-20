/**
 * A graph view's data: the snapshot of its scope, read through the snapshot pipeline and extended by the live stream,
 * and the neighbourhood of a record a reader chooses (CA3D7).
 */
import { QuadGraphModel } from "@haibun/core/lib/derivations/quad-graph-model.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import type { AccessLevel } from "@haibun/core/lib/domains/resources.js";
import { pageConduit, registryScope } from "../../root.js";
import { pageGraphSnapshots } from "../root.js";
import { readSteps } from "../../pipelines/read-steps.js";
import { readSnapshot, snapshotKey } from "../pipelines/snapshot.js";
import { INCOMING_LIMIT, neighbourhoodOf } from "../derivations/neighbourhood.js";
import { DEFAULT_PER_TYPE_LIMIT, type TGraphSnapshot, type TSnapshotListener, type TViewContext } from "../domains/snapshot.js";
import { getRels, getTitledBy } from "../../controllers/catalog-controller.js";
import { idOf } from "../../controllers/record-controller.js";
import { incomingEdges, readIndividual } from "../../controllers/read-controller.js";
import { cachedGraph, servedGraph } from "../../client-cache/controllers/device-controller.js";
import { appAccessLevel } from "../../controllers/view-query-controller.js";

const accessLevel = (): AccessLevel => appAccessLevel() as AccessLevel;
const model = (perTypeLimit: number): QuadGraphModel => new QuadGraphModel(perTypeLimit, getRels, getTitledBy);
/** The snapshot a scope starts with where streamed data or a pin arrives before its first read. */
const fresh = () => ({
	model: model(DEFAULT_PER_TYPE_LIMIT),
	key: snapshotKey({ scope: "", perTypeLimit: DEFAULT_PER_TYPE_LIMIT, types: undefined, again: false }, accessLevel()),
});

/** Listen to a scope's snapshot and to the view context. Returns the end of the subscription. */
export const subscribeSnapshot = (listener: TSnapshotListener, scope: string): (() => void) => pageGraphSnapshots().subscribe(listener, scope);

/** A scope's snapshot, read without a read; empty before anything is read into it. */
export const currentSnapshot = (scope: string): TGraphSnapshot => pageGraphSnapshots().current(scope);

export const viewContext = (): TViewContext => pageGraphSnapshots().context;

/** Which column has keyboard and actions focus. The active record, which every view dims around, is the current-subject machine's. */
export const setActiveViewId = (id: string | null): void => pageGraphSnapshots().setActiveViewId(id);

/** Merge observed quads into every scope's snapshot, and keep them on the device for the next load. */
export function mergeIntoSnapshots(quads: readonly TQuad[]): void {
	if (quads.length === 0) return;
	pageGraphSnapshots().merge(quads, fresh);
	void servedGraph().setMany([...quads]);
}

/** Pin subjects into a scope's snapshot, so streamed data never evicts what a reader revealed. */
export const pinSubjects = (subjects: Iterable<string>, scope: string): void => pageGraphSnapshots().pin(scope, subjects, fresh);

export class GraphDataController {
	/** `scope` names the snapshot the view reads: "" for the shared main graph, or a view's own. */
	constructor(private readonly scope: string) {}

	/** Read the scope's snapshot again, at `perTypeLimit`, of `types` or of every type. */
	readSnapshot(perTypeLimit: number, types: readonly string[] | undefined): Promise<TGraphSnapshot> {
		const scope = { steps: () => readSteps(registryScope()), conduit: pageConduit, served: servedGraph, held: cachedGraph, model, accessLevel: accessLevel() };
		return readSnapshot(scope, pageGraphSnapshots(), { scope: this.scope, perTypeLimit, types, again: true });
	}

	/** Bring the neighbourhood of the record `label` `id` names into the snapshot, pinned, and return the types it touched. */
	async expand(label: string, id: string): Promise<Set<string>> {
		const [individual, incoming] = await Promise.all([readIndividual(label, id, accessLevel()), incomingEdges(label, id, { limit: INCOMING_LIMIT, offset: 0 })]);
		const { quads, pinned, types } = neighbourhoodOf(label, id, individual, incoming, idOf, Date.now());
		pinSubjects(pinned, this.scope);
		mergeIntoSnapshots(quads);
		return types;
	}
}
