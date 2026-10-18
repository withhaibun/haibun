/**
 * The ports of the step infrastructure: the events hub and the sinks it writes through, the secrets it obscures, and the
 * store of quads that working memory and the backing stores implement.
 */
import type { THaibunEvent, TArtifactEvent, THaibunLogLevel, TEventKind } from "../domains/protocol.js";
import type { TAccessBound } from "../actions.js";
import type { AccessLevel } from "../resources.js";
import type { TFeatureStep } from "./domains/stepper.js";
import type { TClusteredQuads, TClusteredQuadsOpts, TDensityQuery, TDensityResult, TDistinctValues, TGraphQuery, TQuad, TQuadPattern, TRecordsPage } from "./domains/quad-types.js";

/** A subscriber of the events hub. It receives each event once the hub has obscured its secrets and stated its level. */
export type TEventSubscriber = (event: THaibunEvent) => void;

/** The events a subscriber receives. `kinds` delivers those kinds only, and is the only way to receive a blip. `names`
 *  delivers only blips whose declared name matches an entry in full or as a dotted prefix (`haibun.http` matches
 *  `haibun.http.request`), and requires `kinds` to include `"blip"`. */
export type TSubscribeOptions = { kinds?: readonly TEventKind[]; names?: readonly string[] };

/** Writes the serialized form of each narrated event, such as to the console. */
export type TEventSink = { write: (serialized: string) => void };

/** The secrets an event may hold: the value of each secret actuality holds. */
export type TSecrets = { values: () => readonly string[] };

/** The events hub. Every event of actuality is emitted through it once, and it delivers each to its subscribers and its sink. */
export interface IEventLogger {
	suppressConsole: boolean;
	/** Whether NDJSON output of events was requested. It takes precedence over a monitor's console suppression. */
	readonly ndjsonForced: boolean;
	subscribe(callback: TEventSubscriber, options?: TSubscribeOptions): void;
	unsubscribe(callback: TEventSubscriber): void;
	hasSubscribers(kind: TEventKind, name?: string): boolean;
	emit(event: THaibunEvent): void;
	log(featureStep: TFeatureStep, level: THaibunLogLevel, message: string, attributes?: Record<string, unknown>): void;
	/** Logs at a level without a feature step, such as from a cycle or a helper. */
	info(message: string, attributes?: Record<string, unknown>): void;
	debug(message: string, attributes?: Record<string, unknown>): void;
	warn(message: string, attributes?: Record<string, unknown>): void;
	error(message: string, attributes?: Record<string, unknown>): void;
	artifact(artifact: TArtifactEvent): void;
}

/** The levels a store applies: the bound a read is read within, the bound a write is written within, and the level each
 *  type declares its records at, undefined for a name that isn't a persisted type. A store that isn't given levels holds a
 *  copy of what a site served, which was bounded where it was served. */
export type TStoreLevels = { bound: () => TAccessBound; writeBound: () => TAccessBound; declared: (label: string) => AccessLevel | undefined };

/** A store of quads: working memory, a backing store with a query engine, a page's copy of what a site served, or another
 *  instance's store. Every method is async, so an in-memory store and a store with a database implement one port. */
export interface IQuadStore {
	/** True for a store that another instance serves (RemoteQuadStore). A read scoped `"own"` reads what this instance is
	 *  authoritative for, so it skips such a store: its records are the serving instance's own, in that instance's report. */
	readonly isRemote?: boolean;

	/** Writes a value, replacing the quad of the same subject, predicate and named graph. */
	set(subject: string, predicate: string, object: unknown, namedGraph: string, properties?: Record<string, unknown>): Promise<void>;

	/** Reads the most recent value of a subject and a predicate. */
	get(subject: string, predicate: string, namedGraph?: string): Promise<unknown | undefined>;

	/** Adds a quad without replacing a quad of the same subject and predicate. */
	add(quad: Omit<TQuad, "timestamp">): Promise<void>;

	/** Reads the quads a pattern matches. */
	query(pattern: TQuadPattern): Promise<TQuad[]>;

	/** Removes the quads of a named graph, or every quad this store holds in its own layer. */
	clear(namedGraph?: string): Promise<void>;

	/** Removes the quads a pattern matches. */
	remove(pattern: TQuadPattern): Promise<void>;

	/** Reads every quad. */
	all(): Promise<TQuad[]>;

	/** Reads a page of records. Rejects a page outside 1 to `MAX_PAGE_ROWS` records, a count ceiling above `COUNT_CEILING`,
	 *  and a read the store doesn't reach, with the text of `readRefusal`. Counts to the ceiling and states the page's order. */
	readRecords(query: TGraphQuery): Promise<TRecordsPage>;

	/** Writes and deletes one record. The named graph is the record's persisted type. */
	upsertIndividual(label: string, data: unknown): Promise<string>;
	deleteIndividual(label: string, id: string): Promise<void>;
	/** Returns the distinct values of a property, in order, up to `COUNT_CEILING`, and states where the count stopped. */
	distinctPropertyValues(label: string, property: string): Promise<TDistinctValues>;

	/** Counts the records in each division of a span of time, by each record's outcome. A view of a span of any length reads
	 *  this, and its time doesn't grow with the span. */
	density(query: TDensityQuery): Promise<TDensityResult>;

	/**
	 * Reads a sample of each requested type, or of every type the store holds where `types` is absent: the quads of up to
	 * `perTypeLimit` records of each type, and a summary of each type's count, so a view renders a `+N more` node where the
	 * sample leaves records out. Every store samples at its source and doesn't read every quad to slice the sample.
	 * `accessLevel` bounds the read as every other read: the sample, its edges, its labels and its counts are read within
	 * it, so a view doesn't show a node its reader can't open.
	 */
	getClusteredQuads(opts: TClusteredQuadsOpts): Promise<TClusteredQuads>;

	/**
	 * Writes one edge between two records. A store with a graph engine writes the edge as a relationship a query walks, in
	 * place of a property. The in-memory store writes an edge as a quad, and a caller writes it through `add` where a store
	 * doesn't implement this method. A second write of the same edge doesn't add another.
	 */
	createEdge?(fromLabel: string, fromId: string, edgeLabel: string, toLabel: string, toId: string): Promise<void>;
	/**
	 * Writes an edge to a target that the store may not hold. A store that keeps edges strictly writes a reference in place
	 * of an absent target, and a later write of the target replaces it. The write doesn't state whether the store held the
	 * target, so a caller that doesn't hold a read action writes it.
	 */
	referenceEdge?(fromLabel: string, fromId: string, edgeLabel: string, toLabel: string, toId: string): Promise<void>;
}

/**
 * A federated peer's clustered read: the sample a peer serves within an access level. A peer isn't a backing store that
 * a store routes reads and writes to: it doesn't serve a pattern query or a write. `site` is the peer's site principal,
 * which states the site of every record it serves.
 */
export interface TFederatedGraphSource {
	site: string;
	getClusteredQuads(opts: TClusteredQuadsOpts): Promise<TClusteredQuads>;
}
