/**
 * The ports of a page's reads and writes. `page/root.ts` installs one adapter for each on the page, and every bundle on the
 * page reads the installed one.
 */
import type { TLink, TRepresentation, TStreamChunk } from "./domains/links.js";

/** An element's stored fields, by its tag and its instance's key. Each tag holds one record of its instances' fields. */
export type TPreferences = {
	/** Returns the fields stored for the instance `key` of `tag`, a held write's fields first, or undefined where it doesn't
	 *  hold any. */
	read(tag: string, key: string): Record<string, unknown> | undefined;
	/** Stores the fields `fields` returns for the instance `key` of `tag`. Each watcher of the instance receives them at once,
	 *  and the store writes them after a trailing pause, from a second call of `fields`, so a burst of changes writes once
	 *  with the latest values. */
	write(tag: string, key: string, fields: () => Record<string, unknown>): void;
	/** Removes the instance's stored fields and the write it holds for them, so the next instance opens with its initial
	 *  state. */
	forget(tag: string, key: string): void;
	/** Writes every held write now. */
	flush(): void;
	/** Calls `fn` with the instance's fields on each write or removal of them. Returns the call that stops it. */
	watch(tag: string, key: string, fn: (fields: Record<string, unknown> | undefined) => void): () => void;
};

/** The page's time: the instant now, a call after a delay, and a call on the next frame the browser draws. */
export type TClock = {
	/** Returns the instant now, in epoch milliseconds. */
	now(): number;
	/** Calls `fn` after `ms` milliseconds. Returns the call that cancels it. */
	after(ms: number, fn: () => void): () => void;
	/** Calls `fn` before the browser draws its next frame. Returns the call that cancels it. */
	frame(fn: () => void): () => void;
};

/** An event actuality sends the page: a lifecycle, a log or a time-sync event. */
export type TEvent = Record<string, unknown>;
/** Selects the events a subscriber receives. */
export type TEventFilter = (event: TEvent) => boolean;

/** What an event stream reports of its connection: it opened (first or again), it broke, or it closed. */
export type TStreamReports = { opened(): void; broke(): void; closed(): void };

/** The events actuality sends the page. A live page reads them from actuality's stream, and a page that carries a record
 *  of actuality reads them from that record. */
export type TEventStream = {
	/** Calls `handler` with each event `filter` selects: first each event the stream holds, then each new one. Returns the
	 *  call that stops it. */
	subscribe(handler: (event: TEvent) => void, filter?: TEventFilter): () => void;
	/** Opens the stream. The page's start opens it before a view reads actuality, since actuality sends only the events after
	 *  a page connects, and the stream holds the events that arrive before a view subscribes. */
	connect(): void;
	/** Calls `fn` at each opening of the stream, and at once where it is open. Returns the call that stops it. */
	opened(fn: () => void): () => void;
	/** Calls `fn` when the stream opens again after a break. The events of the break don't reach a subscriber, so a view
	 *  that follows actuality reads again. Returns the call that stops it. */
	reconnected(fn: () => void): () => void;
	/** Calls `fn` when the stream breaks, and at once where it is broken. Returns the call that stops it. */
	disconnected(fn: () => void): () => void;
	/** Returns how many events the stream received, including those its buffer dropped. */
	totalRecorded(): number;
	/** Closes the stream and removes its subscriptions. */
	close(): void;
};

/** The page's calls of actuality's steps. A served page calls its site, and a test installs a conduit over a map of responses. */
export type TConduit = {
	/** Calls the step `link` names and returns its products. `why` states the reader's intent, which an act records in
	 *  actuality. Throws where the site doesn't respond, refuses the call, or returns a malformed response. */
	follow<T = TRepresentation>(link: TLink, why: string): Promise<T>;
	/** Calls the step `link` names and passes each chunk it streams to `onChunk`. `opts.onStart` receives the place in
	 *  actuality's sequence before the first chunk, and `opts.signal` stops the stream. Returns that place. */
	followStream(link: TLink, onChunk: (chunk: TStreamChunk) => void, opts: { why: string; signal?: AbortSignal; onStart?: (seqPath: number[]) => void }): Promise<{ seqPath: number[] }>;
	/** Calls `fn` with a conduit whose calls are each a part of one act of actuality, under one place in its sequence. Each
	 *  group holds its own place. */
	group<T>(why: string, fn: (g: TConduit) => Promise<T>): Promise<T>;
};
