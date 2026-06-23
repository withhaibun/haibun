/**
 * QuadGraphModel — the in-memory clustered quad graph, shared by every consumer.
 *
 * One implementation of the graph operations: dedup-indexed quads + per-type cluster summaries
 * (sampled/omitted counts, display labels), bounded by a per-type budget plus pinned subjects.
 * The SERVER builds a snapshot by feeding it AGE-sampled quads (injecting the true per-type totals
 * and SQL-fetched body previews); the CLIENT holds the live snapshot, feeding it the RPC backfill
 * and live SSE quads (reading body previews from its own in-memory body quads). Same merge, same
 * relabel — the only differences are the injected providers, never the logic.
 *
 * No persistence lives here: the backing store (AGE server-side, IndexedDB client-side) is the
 * `IQuadStore` behind the model. Consumer-specific identity (e.g. the `@id` IRI prefix) is also
 * never hardcoded here — it is injected, so core names no downstream.
 */
import type { TCluster, TClusteredQuads, TQuad } from "./quad-types.js";
import { displayLabelForQuads } from "./hypermedia.js";
import { BODY_LABEL } from "./resources.js";

const quadKey = (q: TQuad): string => `${q.namedGraph}|${q.subject}|${q.predicate}`;

/** Rels for a type, used by the shared display-label rule. Server: the registry's fields; client: getRels. */
export type RelsProvider = (type: string) => Record<string, string> | undefined;

/** Body preview text for a body subject. Client: read from in-memory body quads (the default); server: SQL previews. */
export type BodyContentProvider = (subject: string) => string | undefined;

export type MergeOptions = {
	/** Authoritative per-type total from the store (the AGE count). Without it, totalCount is the observed distinct-subject count. */
	totalCounts?: Map<string, number>;
	/** Where body preview text comes from for the display-label rule. Defaults to the model's own in-memory body quads. */
	bodyContentFor?: BodyContentProvider;
	/** Skip the in-memory relabel — the consumer sets `displayLabels` itself (e.g. the server, from subject-keyed SQL previews). Omitted = relabel. */
	skipRelabel?: boolean;
};

export class QuadGraphModel {
	readonly quads: TQuad[] = [];
	readonly clusters: TCluster[] = [];
	private readonly quadIndex = new Map<string, number>();
	private readonly pinned = new Set<string>();
	/** Stable wrapper over the live arrays — its identity never changes across merges, so a consumer that diffs the snapshot by reference isn't tricked into re-laying-out (which re-spreads the graph off-frame). */
	private readonly stableSnapshot: TClusteredQuads = { quads: this.quads, clusters: this.clusters };

	constructor(
		private readonly budget: number,
		private readonly relsFor: RelsProvider,
	) {}

	get snapshot(): TClusteredQuads {
		return this.stableSnapshot;
	}

	/** Subjects pinned into the working set — read-only, for carrying the set across a re-seed. */
	get pinnedSubjects(): ReadonlySet<string> {
		return this.pinned;
	}

	/** Adopt an already-clustered snapshot (e.g. a server RPC result) verbatim, so later merges extend it rather than recompute it. */
	seed(snapshot: TClusteredQuads): void {
		this.quads.length = 0;
		this.clusters.length = 0;
		this.quadIndex.clear();
		for (const q of snapshot.quads) {
			this.quadIndex.set(quadKey(q), this.quads.length);
			this.quads.push(q);
		}
		for (const c of snapshot.clusters) this.clusters.push(c);
	}

	/** Pin subjects into the working set so a budget-bounded merge can never evict them. */
	pin(subjects: Iterable<string>): void {
		for (const s of subjects) this.pinned.add(s);
	}

	/**
	 * Merge quads, bounded by the per-type budget: a quad for a present subject updates in place; a brand-new
	 * subject is admitted only while its type is under budget (or pinned), otherwise counted as omitted and its
	 * quad dropped. The dedup index is maintained per quad (no rescan). Returns the subjects touched.
	 */
	merge(quads: TQuad[], opts: MergeOptions = {}): Set<string> {
		const touched = new Set<string>();
		if (quads.length === 0) return touched;
		const clusterByType = new Map<string, TCluster>();
		const sampledByType = new Map<string, Set<string>>();
		for (const c of this.clusters) {
			clusterByType.set(c.type, c);
			sampledByType.set(c.type, new Set(c.sampledSubjects));
		}
		// Count each genuinely-new subject once per call, even when it arrives as many quads — its later
		// (omitted, unindexed) quads would otherwise re-inflate totalCount.
		const countedThisCall = new Set<string>();
		for (const q of quads) {
			const key = quadKey(q);
			const existingIdx = this.quadIndex.get(key);
			// The stream can emit the same fact twice (a property quad on upsert, the edge quad on createEdge);
			// replace in place so the later arrival wins.
			if (existingIdx !== undefined) {
				this.quads[existingIdx] = q;
				touched.add(q.subject);
				continue;
			}
			let cluster = clusterByType.get(q.namedGraph);
			if (!cluster) {
				cluster = { type: q.namedGraph, totalCount: 0, sampledCount: 0, omittedCount: 0, sampledSubjects: [], displayLabels: {} };
				this.clusters.push(cluster);
				clusterByType.set(q.namedGraph, cluster);
				sampledByType.set(q.namedGraph, new Set());
			}
			const sampled = sampledByType.get(q.namedGraph) ?? new Set<string>();
			const known = sampled.has(q.subject) || this.pinned.has(q.subject);
			if (!known) {
				const subjectKey = `${q.namedGraph}|${q.subject}`;
				if (!countedThisCall.has(subjectKey)) {
					countedThisCall.add(subjectKey);
					cluster.totalCount += 1;
				}
				if (sampled.size < this.budget) {
					sampled.add(q.subject);
					cluster.sampledSubjects.push(q.subject);
					cluster.sampledCount = sampled.size;
				} else {
					// Type at budget and subject unpinned — omit it: count it, drop its quad.
					cluster.omittedCount = Math.max(0, cluster.totalCount - cluster.sampledCount);
					continue;
				}
			}
			this.quadIndex.set(key, this.quads.length);
			this.quads.push(q);
			cluster.omittedCount = Math.max(0, cluster.totalCount - cluster.sampledCount);
			touched.add(q.subject);
		}
		// The store's authoritative totals override the observed count (the AGE total is the truth).
		if (opts.totalCounts)
			for (const c of this.clusters) {
				const t = opts.totalCounts.get(c.type);
				if (t !== undefined) {
					c.totalCount = t;
					c.omittedCount = Math.max(0, t - c.sampledCount);
				}
			}
		if (!opts.skipRelabel) this.relabel(touched, opts.bodyContentFor);
		return touched;
	}

	/** Recompute `displayLabels` for the touched subjects via the one shared rule, sourcing body text from the provider. */
	private relabel(touched: Set<string>, bodyContentFor?: BodyContentProvider): void {
		if (touched.size === 0) return;
		const inMemoryBody = new Map<string, string>();
		const quadsBySubject = new Map<string, TQuad[]>();
		for (const q of this.quads) {
			if (!bodyContentFor && q.namedGraph === BODY_LABEL && q.predicate === "content" && typeof q.object === "string") inMemoryBody.set(q.subject, q.object);
			if (!touched.has(q.subject)) continue;
			let bucket = quadsBySubject.get(q.subject);
			if (!bucket) {
				bucket = [];
				quadsBySubject.set(q.subject, bucket);
			}
			bucket.push(q);
		}
		const bodyFor = bodyContentFor ?? ((b: string) => inMemoryBody.get(b));
		for (const [subject, subjectQuads] of quadsBySubject) {
			const type = subjectQuads[0]?.namedGraph ?? "";
			const cluster = this.clusters.find((c) => c.type === type);
			if (!cluster) continue;
			cluster.displayLabels[subject] = displayLabelForQuads(type, subject, subjectQuads, bodyFor, this.relsFor(type));
		}
	}
}
