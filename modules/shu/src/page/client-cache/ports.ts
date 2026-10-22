/**
 * The client cache's ports: the graph of an actuality's records, the device's databases and its registry, and the source of a
 * view's rows of actuality.
 */
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import type { TDensityQuery, TDensityResult, TGraphQuery, TGraphQueryResult, TQuad } from "@haibun/core/lib/quad-types.js";
import type { THaibunLogLevel } from "@haibun/core/lib/domains/protocol.js";
import type { WindowedSource } from "../derivations/windowed-source.js";
import type { Range } from "../derivations/rail.js";

/**
 * What reading an actuality needs of the graph. An actuality is read three ways: the records of one type by time, how many
 * fall in each division of a span, and whether the graph carries a type at all. Every reading states which graph it reads, so
 * a page reads through its site and its own copy, a report reads the copy it carries, and a test reads a store it made.
 */
export type TActualityGraph = {
	/** The records of one type the query names. */
	query(query: TGraphQuery): Promise<TGraphQueryResult>;
	/** How many records of one type fall in each division of a span, by how each turned out. */
	density(query: TDensityQuery): Promise<TDensityResult>;
	/** Whether the graph carries this type. A type it doesn't carry doesn't hold a record to read. */
	declares(label: string): boolean;
};

/** What the cached data means, apart from the database's structure. Change it whenever data written by an earlier build
 *  would be read wrongly by this one: the device then clears what it cached rather than serving it, and a report written
 *  by another build isn't read. */
export const CACHE_SHAPE = "actuality-records/2";

/** The stores of one actuality's database on the device. */
export const DEVICE_STORES = { META: "meta", QUADS: "quads" } as const;

/** The meta store's keys: the site's registry, the shape the data is written in, and the count of quads dropped at the bound. */
export const META_KEY = { REGISTRY: "registry", SHAPE: "shape", DROPPED: "dropped" } as const;

/** The indexes of the quads a device holds: by fact (graph, subject and predicate), by subject, by type, by object, and by
 *  the time each was held. */
export const QUAD_INDEX = { SPG: "by-spg", SUBJECT: "by-subject", NAMED_GRAPH: "by-named-graph", OBJECT: "by-object", TIME: "by-time" } as const;

/** One actuality's database on the device: a transaction over the stores it names, read-only or read-write, resolving with
 *  what `fn` returns once it commits. `fn` issues each request before it awaits a result, and the transaction commits as
 *  `fn` issues them. It resolves undefined where the browser doesn't offer IndexedDB. */
export type TDeviceDatabase = { readonly name: string; within<T>(mode: IDBTransactionMode, stores: string[], fn: (tx: IDBTransaction) => T | Promise<T>): Promise<T | undefined> };

/** How the device reports what a reader doesn't see otherwise: a warning, and a failure with its cause. */
export type TDeviceReport = { warn(message: string): void; failure(message: string, err: unknown): void };

/** How full a database's graph is: the quads it holds, the most it holds, and how many of the oldest it dropped to stay
 *  within that bound. */
export type TGraphSaturation = { held: number; bound: number; dropped: number };

/** A graph the page caches, which holds facts in one write. */
export type TCachedGraph = IQuadStore & { setMany(quads: TQuad[]): Promise<void> };

/** The quads one actuality's database holds: the facts as the device writes and reads them, and how full it is. */
export type TDeviceQuads = Pick<IQuadStore, "set" | "get" | "add" | "query" | "clear" | "remove" | "all"> & {
	/** The name of the database. */
	readonly database: string;
	setMany(quads: TQuad[]): Promise<void>;
	saturation(): Promise<TGraphSaturation>;
};

/** The graph of one actuality's records the device holds: its quads, read as records. */
export type TDeviceGraph = TCachedGraph & Pick<TDeviceQuads, "database" | "saturation">;

/** The site's registry as the device caches it: the step list response (steps, concerns, domains), and when it was cached. */
export type TStoredRegistry = { savedAt: number; response: unknown };

/** What the client cache requests of the device: the site's registry as last cached, a cache of it, and a clearing of
 *  what is cached. */
export interface TDeviceStore {
	registry(): Promise<TStoredRegistry | undefined>;
	setRegistry(response: unknown): Promise<void>;
	clear(): Promise<void>;
}

/** A row of actuality as a view renders it. */
export type TEventRecord = Record<string, unknown>;

/** What actuality spans at one level: how many rows, when it began, and the instant of its newest. */
export type TActualityExtent = { total: number; first?: number; last?: number };

/** A reading of actuality at one level, the source of a view's rows. */
export interface ActualitySource extends WindowedSource<TEventRecord> {
	/** The level this source reads at (its rows are at this level and up). */
	readonly level: THaibunLogLevel;
	/** The count of changes of what the source holds or states: a view derives from the source again only where it differs. */
	readonly version: number;
	/** Actuality's extent as read: how many rows at this level, when actuality began, and the instant of its newest. */
	extent(): TActualityExtent;
	/** The index spans held, in order: what a view derives its marks and cursor from, never a scan of the extent. */
	cachedRanges(): Range[];
	/** How many rows a page holds: a view that derives per page (the document's blocks) aligns to it. */
	readonly pageSize: number;
	/** Whether the extent has been read. */
	readonly loaded: boolean;
	/** Why actuality could not be read, or null. */
	readonly unavailable: string | null;
	/** Whether actuality is finished. */
	readonly ended: boolean;
	/** Whether the stream is down, so what actuality has done since the last read is absent from this page. */
	readonly disconnected: boolean;
	/** Whether actuality has announced something this reading has not yet read for: true from the announcement, or from
	 *  the stream coming back, until a read begun after it has finished. */
	readonly behind: boolean;
	/** Reads the extent where it is unread: the first thing a view awaits. */
	ready(): Promise<void>;
	/** Read actuality around a moment, or follow its newest records where a moment isn't named. */
	readAt(at?: number): Promise<void>;
}

/** What the page reads actuality by: the sources the views read, each made source's listeners, the moment every view reads
 *  around (undefined follows the newest records), and what actuality spans as any reading has seen it. */
export type TActualityRegistry = { reading: Set<ActualitySource>; made: Set<(source: ActualitySource) => void>; at?: number; span: { first?: number; last?: number } };
