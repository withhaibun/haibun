/**
 * QuadGraphModel holds the in-memory clustered quad graph that every consumer shares.
 *
 * It implements the graph operations once. It holds dedup-indexed quads and per-type cluster summaries (sampled and
 * omitted counts, display labels). A per-type limit bounds each cluster, and pinned subjects are admitted past it.
 * The server builds a snapshot by merging quads sampled from the site's store. It injects the store's per-type totals
 * and SQL-fetched body previews. The client holds the live snapshot and merges the RPC backfill and live SSE quads into
 * it. The client reads body previews from its own in-memory body quads. Both sides run the same merge and relabel, and
 * only the injected providers differ.
 *
 * This module doesn't persist quads. The `IQuadStore` behind the model persists them: the site's graph store on the
 * server and IndexedDB on the client. The consumer injects its own identity, such as the `@id` IRI prefix, so core
 * doesn't name a downstream.
 */
import type { TCluster, TClusteredQuads, TQuad } from "../steps/domains/quad-types.js";
import { displayLabelForQuads, type TDeclaredTitle, type TTitledBy } from "../domains/hypermedia.js";
import { BODY_LABEL, LinkRelations } from "../domains/resources.js";

// A scalar property quad (without objectType) keys by named graph, subject and predicate. A later value for the same fact
// replaces it in place, such as an updated `subject`, a rescheduled gantt `startedAtTime` or an `accessLevel` change. An
// edge quad (objectType set) also keys by object, because one subject can reference several objects under one predicate.
// In a federated union a shared node is `wasAttributedTo` several principals (issuer, holder, verifier), so the merge
// keeps every distinct edge and doesn't replace the earlier ones with the last (§7-2). An edge that arrives again with the
// same object has the same key, so the dedup of property quads and edge quads doesn't change.
const quadKey = (q: TQuad): string =>
	q.objectType !== undefined ? `${q.namedGraph}|${q.subject}|${q.predicate}|${String(q.object)}` : `${q.namedGraph}|${q.subject}|${q.predicate}`;

/** Returns a type's rels for the shared display-label rule. The server reads the registry's fields and the client calls getRels. */
type RelsProvider = (type: string) => Record<string, string> | undefined;

/** Returns the property or edge a type declares as its title (topology.displayLabel), or undefined where it doesn't declare
 *  one. The server reads the registry's titledBy and the client reads getTitledBy from the rels cache. */
type TitledByProvider = (type: string) => TTitledBy | undefined;

/** Returns the body preview text for a body subject. The client reads in-memory body quads by default, and the server reads SQL previews. */
type BodyContentProvider = (subject: string) => string | undefined;

type MergeOptions = {
	/** Each type's total from the store's own count. totalCount counts the distinct merged subjects where this is absent. */
	totalCounts?: Map<string, number>;
	/** The source of body preview text for the display-label rule. The default reads the model's own in-memory body quads. */
	bodyContentFor?: BodyContentProvider;
	/** Skips the in-memory relabel. The consumer sets `displayLabels` itself, as the server does from subject-keyed SQL previews. Omitted means relabel. */
	skipRelabel?: boolean;
};

export class QuadGraphModel {
	readonly quads: TQuad[] = [];
	readonly clusters: TCluster[] = [];
	private readonly quadIndex = new Map<string, number>();
	private readonly pinned = new Set<string>();
	/** A wrapper over the live arrays whose identity doesn't change across merges. A consumer that diffs the snapshot by reference then doesn't lay the graph out again, which would spread it out of frame. */
	private readonly stableSnapshot: TClusteredQuads = { quads: this.quads, clusters: this.clusters };

	constructor(
		private readonly limit: number,
		private readonly relsFor: RelsProvider,
		private readonly titledByFor: TitledByProvider = () => undefined,
	) {}

	get snapshot(): TClusteredQuads {
		return this.stableSnapshot;
	}

	/** Returns the pinned subjects read-only, so a caller can carry them across a re-seed. */
	get pinnedSubjects(): ReadonlySet<string> {
		return this.pinned;
	}

	/** Replaces the quads and clusters with an already-clustered snapshot unchanged, such as a server RPC result. Later merges extend it and don't recompute it. */
	seed(snapshot: TClusteredQuads): void {
		this.quads.length = 0;
		this.clusters.length = 0;
		this.quadIndex.clear();
		// The stable wrapper holds the responding instance's site principal. Merges extend the quads and clusters and don't change the site.
		this.stableSnapshot.site = snapshot.site;
		for (const q of snapshot.quads) {
			this.quadIndex.set(quadKey(q), this.quads.length);
			this.quads.push(q);
		}
		for (const c of snapshot.clusters) this.clusters.push(c);
	}

	/** Pins subjects into the working set. A merge admits their quads past the type's limit. */
	pin(subjects: Iterable<string>): void {
		for (const s of subjects) this.pinned.add(s);
	}

	/**
	 * Merges quads under the per-type limit. A quad whose key is already indexed replaces the indexed quad in place. A new
	 * subject is admitted while its type is under the limit or when it is pinned. Otherwise the merge counts it as omitted
	 * and drops its quad. The dedup index is updated per quad without a rescan. Returns the subjects touched.
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
		// Count each new subject once per call even when it arrives as several quads. Its later omitted quads would
		// otherwise increment totalCount again.
		const countedThisCall = new Set<string>();
		for (const q of quads) {
			const key = quadKey(q);
			const existingIdx = this.quadIndex.get(key);
			// The stream can emit the same fact twice: a property quad on upsert and the edge quad on createEdge.
			// Replacing in place keeps the later quad.
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
				if (sampled.size < this.limit) {
					sampled.add(q.subject);
					cluster.sampledSubjects.push(q.subject);
					cluster.sampledCount = sampled.size;
				} else {
					// The type is at its limit and the subject isn't pinned. Count the subject as omitted and drop its quad.
					cluster.omittedCount = Math.max(0, cluster.totalCount - cluster.sampledCount);
					continue;
				}
			}
			this.quadIndex.set(key, this.quads.length);
			this.quads.push(q);
			cluster.omittedCount = Math.max(0, cluster.totalCount - cluster.sampledCount);
			touched.add(q.subject);
		}
		// The store's totals replace the counts this model computed.
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

	/** Labels the touched subjects with the shared display-label rule and reads body text from the provider. Every
	 *  subject's quads are bucketed, not only the touched ones. A type titled through an iri-ranged rel then resolves its
	 *  target's quads even when this merge didn't touch the target.
	 *
	 *  A subject that already has a title keeps it. The seed reads the whole record, its body included, and a merge reads
	 *  only the quads it receives. A request narrowed to some types doesn't carry body quads, and a title computed from the
	 *  remaining quads would replace the record's own text with a weak pointer such as its seqPath. This method titles only
	 *  an untitled subject or one whose title is its bare id. */
	private relabel(touched: Set<string>, bodyContentFor?: BodyContentProvider): void {
		if (touched.size === 0) return;
		const inMemoryBody = new Map<string, string>();
		const quadsBySubject = new Map<string, TQuad[]>();
		for (const q of this.quads) {
			if (!bodyContentFor && q.namedGraph === BODY_LABEL && q.predicate === LinkRelations.CONTENT.rel && typeof q.object === "string") inMemoryBody.set(q.subject, q.object);
			let bucket = quadsBySubject.get(q.subject);
			if (!bucket) {
				bucket = [];
				quadsBySubject.set(q.subject, bucket);
			}
			bucket.push(q);
		}
		const bodyFor = bodyContentFor ?? ((b: string) => inMemoryBody.get(b));
		for (const subject of touched) {
			const subjectQuads = quadsBySubject.get(subject);
			if (!subjectQuads) continue;
			const type = subjectQuads[0]?.namedGraph ?? "";
			const cluster = this.clusters.find((c) => c.type === type);
			if (!cluster) continue;
			const titled = cluster.displayLabels[subject];
			if (titled !== undefined && titled !== subject) continue;
			cluster.displayLabels[subject] = displayLabelForQuads(
				type,
				subject,
				subjectQuads,
				bodyFor,
				this.relsFor(type),
				this.declaredLabelFor(type, subject, quadsBySubject, bodyFor),
			);
		}
	}

	/**
	 * Resolves the type's declared title (topology.displayLabel) for this node. Returns undefined when the type doesn't
	 * declare one. A declared property is returned as declared, and composeDisplayLabel reads its value from the node's
	 * quads. A declared edge adds the title of the edge's target record, computed from the same quads as the server's
	 * batchLinkedLabels computes it. A record titled through a second record that is titled through a third takes the
	 * third record's title. A target already in `met` ends the chain, so a cycle terminates.
	 */
	private declaredLabelFor(
		type: string,
		subject: string,
		quadsBySubject: Map<string, TQuad[]>,
		bodyFor: BodyContentProvider,
		met: ReadonlySet<string> = new Set(),
	): TDeclaredTitle | undefined {
		const titledBy = this.titledByFor(type);
		if (!titledBy?.through) return titledBy;
		const edge = (quadsBySubject.get(subject) ?? []).find((q) => q.predicate === titledBy.key && q.objectType !== undefined);
		if (!edge || met.has(String(edge.object))) return titledBy;
		const targetType = String(edge.objectType);
		const targetId = String(edge.object);
		const targetDeclared = this.declaredLabelFor(targetType, targetId, quadsBySubject, bodyFor, new Set([...met, subject]));
		const linkedLabel = displayLabelForQuads(targetType, targetId, quadsBySubject.get(targetId) ?? [], bodyFor, this.relsFor(targetType), targetDeclared);
		return { ...titledBy, linkedLabel };
	}
}
