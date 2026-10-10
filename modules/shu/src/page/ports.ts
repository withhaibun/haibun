/**
 * The ports of a page's reads and writes. `page/root.ts` installs one adapter for each on the page, and every bundle on the
 * page reads the installed one.
 */
import type { TLink, TRepresentation, TStreamChunk } from "./domains/links.js";
import type { TLongFrame } from "../domains/blips.js";
import type { TFrameMessage } from "../domains/embedding.js";
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import type { TLinkedData } from "@haibun/core/lib/hypermedia.js";
import type { TDelegation } from "@haibun/core/lib/actions.js";
import type { TProveRequest } from "@haibun/core/lib/rpc-wire.js";
import type { TPageAuthority } from "./authority/pipelines/page-authority.js";
import type { TCachePayload, TDeploymentSettings } from "../domains/hydration.js";
import type { TActualityId } from "@haibun/core/lib/rpc-wire.js";

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

/** A value the page holds under a key, which every bundle reads and follows. */
export type TSharedCell<T> = {
	get(): T;
	/** Sets the value, and calls each subscriber where it changed. */
	set(v: T): void;
	/** Calls `cb` with each new value and the value it replaced. Returns the call that stops it. */
	subscribe(cb: (v: T, before: T) => void): () => void;
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

/** The page's location. */
export type TLocation = {
	/** Returns the address's hash. */
	hash(): string;
	/** Writes `hash` as the address's hash through the history, which doesn't raise `hashchange`. */
	replaceHash(hash: string): void;
	/** Calls `fn` at each arrival at a new hash. Returns the call that stops it. */
	onHashArrival(fn: () => void): () => void;
	/** Returns the address without its hash. */
	address(): string;
};

/** The channel between shu's frame and the page that embeds it. */
export type TEmbedderChannel = {
	/** Calls `fn` with each message the embedding window posts at the deployment's origin, and `refused` with the origin of
	 *  each message the embedding window posts at another. Returns the call that stops receiving. */
	receive(fn: (data: unknown) => void, refused: (origin: string) => void): () => void;
	/** Posts `message` to the embedding window, at the deployment's origin alone. */
	post(message: TFrameMessage): void;
};

/** A node a reader opened in a graph presenter, which the presenter reports to its host as `SHU_EVENT.GRAPH_NODE_CLICK`;
 *  the host opens the resource the node names. */
export type TPresenterNodeClick = { nodeId: string };

/** The calls a host makes on the graph presenter it embeds. */
export type TGraphPresenter = HTMLElement & {
	setQuads(quads: TQuad[], clusters?: TCluster[]): void;
	/** Marks the host's current node as active in the graph. `null` means the host isn't on a node. */
	selectNode(id: string | null): void;
	/** Highlights these nodes and dims the rest of the graph. `null` ends the preview. */
	previewNodes(ids: string[] | null): void;
	/** Returns a summary of what the presenter shows, in the form the chat context reads from each view. */
	summarizeForKihan(): TLinkedData | null;
};

/** Where a view holds the graph presenter it embeds. */
export type TPresenterMount = {
	/** Returns the presenter `host` holds in `slot`, or undefined where it doesn't hold one. */
	presenterIn(host: HTMLElement, slot: string): TGraphPresenter | undefined;
	/** Mounts a presenter of `tag` in `host` at `slot`, with its settings under `scope`, and returns it. */
	mount(host: HTMLElement, slot: string, tag: string, scope: string): TGraphPresenter;
};

/** One occurrence a view recorded: its name, its value and attributes where it states them, and when it happened. */
export type TClientBlip = { name: string; value: number | undefined; attributes: Record<string, unknown> | undefined; at: number };

/** The page's ring of the latest occurrences. */
export type TBlipRing = {
	/** Holds `blip`, in place of the oldest where the ring is full. */
	record(blip: TClientBlip): void;
	/** Returns the occurrences the ring holds, oldest first, and empties it. */
	take(): TClientBlip[];
	/** Returns how many occurrences the ring recorded, including those it dropped. */
	recorded(): number;
	/** Returns how many occurrences the ring passed to a send. */
	sent(): number;
};

/** The page's hydration element. */
export type THydrationElement = {
	/** Returns the element's text and empties the element, or undefined where the page doesn't hold the element or it is
	 *  empty. */
	take(): string | undefined;
};

/** The reader's authority on the page, which the page's start installs from the authority area (`page/authority/`). */
export type TAuthority = {
	/** Whether the page holds what `action` requires. */
	may(action: string): boolean;
	/** Returns each action the page holds. */
	holds(): string[];
	/** Returns what the page holds once the read the page started ends, or undefined where the page didn't start one. */
	ready(): Promise<TPageAuthority | undefined>;
	/** Holds a delegation the embedding page gave the page's key, in place of `replacing`. */
	hold(delegation: TDelegation, replacing: TDelegation | undefined): void;
	/** Lets go of what the page holds, so it reads it again. */
	forget(): void;
	/** Returns how a call of `method` is proven, where the call requires `required`. */
	prove(method: string, required: string | undefined): TProveRequest;
	/** Returns the headers of a GET of the absolute address `url` as `action`. */
	readingHeaders(url: string, action: string): Promise<Record<string, string>>;
};

/** What the page holds of its hydration. */
export type THydrationRead = {
	/** Returns the actuality whose records the page reads. Throws where the page wasn't served with it. */
	actualityId(): TActualityId;
	/** Returns the record of actuality the page carries, or undefined for a page a site serves. */
	carried(): TCachePayload | undefined;
	/** Returns the address the page opens at for a reader who arrives without one, or undefined where it doesn't state one. */
	opensAt(): string | undefined;
	/** Returns what the page carries of a view's products, by the step that produces them, or undefined where it doesn't. */
	carriedProducts(method: string): unknown;
	/** Returns what the deployment set for the page it served. Throws for a page a site didn't serve with them. */
	settings(): TDeploymentSettings;
	/** Returns the rounds of tool calls an ask starts with, or undefined where the deployment doesn't set them or a site
	 *  didn't serve the page, as for a page that carries a record of actuality, whose ask doesn't send a turn. */
	askToolLimit(): number | undefined;
};

/** The page's clipboard. */
export type TClipboard = {
	/** Copies `text` to the clipboard, and returns whether the clipboard holds it. */
	copy(text: string): Promise<boolean>;
};

/** The page's custom elements. */
export type TElements = {
	/** Defines `element` under `tag`, where the page doesn't define the tag yet. */
	define(tag: string, element: CustomElementConstructor): void;
	/** Whether the page defines `tag`. */
	isDefined(tag: string): boolean;
	/** Imports `script`, and resolves once it defines `tag`. Throws where the import fails or the script doesn't define
	 *  the element. */
	load(tag: string, script: string): Promise<void>;
};

/** A script the page's Content-Security-Policy refused, as the browser reports it. */
export type TRefusedScript = Pick<SecurityPolicyViolationEvent, "blockedURI" | "effectiveDirective" | "sourceFile" | "lineNumber">;

/** What the browser reports of the page. */
export type TPageObservers = {
	/** Calls `fn` with each script the page's policy refuses. */
	refusedScripts(fn: (refused: TRefusedScript) => void): void;
	/** Calls `fn` with each long animation frame, including the frames before the call. Returns false where the browser
	 *  doesn't report long frames. */
	longFrames(fn: (frame: TLongFrame) => void): boolean;
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
	followStream(
		link: TLink,
		onChunk: (chunk: TStreamChunk) => void,
		opts: { why: string; signal?: AbortSignal; onStart?: (seqPath: number[]) => void },
	): Promise<{ seqPath: number[] }>;
	/** Calls `fn` with a conduit whose calls are each a part of one act of actuality, under one place in its sequence. Each
	 *  group holds its own place. */
	group<T>(why: string, fn: (g: TConduit) => Promise<T>): Promise<T>;
};
