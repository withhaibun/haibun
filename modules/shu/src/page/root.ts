/**
 * The page's composition root. It installs each of the page's ports once per page, and every bundle on the page reads the
 * installed port, since a bundle that loads this module holds its own copy of it.
 */
import { pagePinned } from "./adapters/page-held.js";
import { SharedCell } from "./adapters/shared-cell.js";
import { Machine, machine, type TMove, type TTransition } from "@haibun/core/lib/machine.js";
import type {
	TAuthority,
	TBlipRing,
	TClipboard,
	TClock,
	TConduit,
	TElements,
	TEmbedderChannel,
	THydrationElement,
	THydrationRead,
	TLocation,
	TPresenterMount,
	TPageObservers,
	TEventStream,
	TPreferences,
	TSharedCell,
	TStreamReports,
	TPaneMarks,
	TPaneStrip,
	TStripElement,
	TRemedies,
} from "./ports.js";
import type { TDockedPane, TPageTypes, TStripPane } from "./domains/page-state.js";
import { NOTHING_SELECTED_LABEL, type TPageContext } from "../schemas.js";
import type { TProveRequest } from "@haibun/core/lib/rpc-wire.js";
import { initialConduitHeld, LiveConduit } from "./adapters/live-conduit.js";
import { carriedConduit } from "./adapters/carried-conduit.js";
import { cookiePreferences } from "./adapters/prefs-cookie.js";
import { browserClock } from "./adapters/clock.js";
import { browserClipboard } from "./adapters/clipboard.js";
import { browserElements } from "./adapters/elements.js";
import { browserObservers } from "./adapters/page-observers.js";
import { browserLocation } from "./adapters/location-hash.js";
import { embedderChannel } from "./adapters/embedder-channel.js";
import { browserPresenterMount } from "./adapters/presenter-mount.js";
import { blipRing } from "./adapters/blip-ring.js";
import { documentHydration } from "./adapters/hydration.js";
import type { TBlipChannel, TBlipSending } from "./pipelines/client-blips.js";
import type { TEmbeddedPageView } from "../domains/embedding.js";
import type { TDelegation } from "@haibun/core/lib/actions.js";
import type { THashScope, TPageHash } from "./pipelines/page-hash.js";
import type { TPanesHeld } from "./pipelines/panes.js";
import { browserPaneStrip } from "./adapters/pane-strip.js";
import { browserRemedies } from "./adapters/remedies.js";
import { INITIAL_PANES, panesTransition, type TPanesEvent, type TPanesState } from "./machines/panes.js";
import { liveEventStream, type TLiveStreamSource } from "./adapters/live-event-stream.js";
import { CarriedEventStream } from "./adapters/carried-event-stream.js";
import { FOLLOWS_THE_RUN } from "@haibun/core/lib/actions.js";
import { INITIAL_STREAM_STATUS, STREAM_EVENT, streamTransition, type TStreamEvent, type TStreamStatus } from "./machines/event-stream.js";
import { INITIAL_REGISTRY, registryTransition, type TRegistryEvent, type TRegistryState } from "./machines/registry.js";
import type { TReadStepsScope, TRegistryReads } from "./pipelines/read-steps.js";
import type { TRecordStore } from "./pipelines/open-record.js";
import { pageDeviceStore } from "./client-cache/root.js";

const PREFERENCES_KEY = "__SHU_PREFERENCES__";
const CLOCK_KEY = "__SHU_CLOCK__";
const CLIPBOARD_KEY = "__SHU_CLIPBOARD__";
const ELEMENTS_KEY = "__SHU_ELEMENTS__";
const OBSERVERS_KEY = "__SHU_OBSERVERS__";
const LOCATION_KEY = "__SHU_LOCATION__";
const PAGE_HASH_KEY = "__SHU_PAGE_HASH__";
const EMBEDDER_KEY = "__SHU_EMBEDDER__";
const PRESENTER_MOUNT_KEY = "__SHU_PRESENTER_MOUNT__";
const BLIPS_KEY = "__SHU_CLIENT_BLIPS__";
const EVENT_STREAM_KEY = "__SHU_EVENT_STREAM__";
const STREAM_STATUS_KEY = "__SHU_STREAM_STATUS__";
const CONDUIT_KEY = "__SHU_CONDUIT__";
const CONDUIT_HELD_KEY = "__SHU_CONDUIT_HELD__";
const AUTHORITY_PORT_KEY = "__SHU_AUTHORITY_PORT__";
const HYDRATION_KEY = "__SHU_HYDRATION__";
const REGISTRY_KEY = "__SHU_STEP_REGISTRY__";
const REGISTRY_READS_KEY = "__SHU_STEP_REGISTRY_READS__";
const PANES_KEY = "__SHU_PANES__";
const PANES_HELD_KEY = "__SHU_PANES_HELD__";
const REMEDIES_KEY = "__SHU_REMEDIES__";
const RECORDS_KEY = "__SHU_ENTITY_STORE__";

/** Returns the page's preferences, stored in the page's cookies. */
export const pagePreferences = (): TPreferences => pagePinned(PREFERENCES_KEY, () => cookiePreferences(window));

/** Returns the page's clock: the browser's time, timers and frames, or the clock `installClock` installed. */
export const pageClock = (): TClock => pagePinned(CLOCK_KEY, () => browserClock(window));

/** Installs `clock` as the page's clock where the page doesn't hold one yet. A test installs a clock it advances. */
export const installClock = (clock: TClock): TClock => pagePinned(CLOCK_KEY, () => clock);

/** Returns the page's clipboard. */
export const pageClipboard = (): TClipboard => pagePinned(CLIPBOARD_KEY, () => browserClipboard(window));

/** Returns the page's custom elements. */
export const pageElements = (): TElements => pagePinned(ELEMENTS_KEY, () => browserElements(customElements));

/** Returns what the browser reports of the page. */
export const pageObservers = (): TPageObservers => pagePinned(OBSERVERS_KEY, () => browserObservers(window));

/** Returns the page's location. */
export const pageLocation = (): TLocation => pagePinned(LOCATION_KEY, () => browserLocation(window));

/** Returns what the page holds of its hash. The page stops following arrivals when it ends. */
export const pageHashHeld = (): TPageHash =>
	pagePinned(
		PAGE_HASH_KEY,
		(): TPageHash => ({ stored: "", subscribers: new Set(), stopArrivals: undefined }),
		(held) => held.stopArrivals?.(),
	);

/** Returns the page's hash as its reads and writes take it: the location, what the page holds of the hash, and whether the
 *  page carries a record of actuality, whose hash the page holds itself. */
export const pageHashScope = (): THashScope => ({ location: pageLocation(), held: pageHashHeld(), carried: pageHydration().carried() !== undefined });

/** Returns the page's panes, held across its bundles, and empty on each new page. */
export const pagePanes = (): Machine<TPanesState, TPanesEvent> => pagePinned(PANES_KEY, () => machine(INITIAL_PANES, panesTransition));

/** Returns what the page holds of its panes beside their machine. */
export const panesHeld = (): TPanesHeld =>
	pagePinned(PANES_HELD_KEY, (): TPanesHeld => ({ strip: undefined, hooks: undefined, lastWritten: undefined, reconciling: false, requested: false }));

/** Returns the pane strip over `strip`, whose panes carry the names `marks` gives. */
export const pagePaneStrip = (strip: TStripElement, marks: TPaneMarks): TPaneStrip => browserPaneStrip(document, customElements, strip, marks);

/** Returns the remedies the page performs itself. */
export const pageRemedies = (): TRemedies => pagePinned(REMEDIES_KEY, () => browserRemedies(window.location));

/** Installs `remedies` as the page's, before a read of them, as a test installs a fake. */
export const installRemedies = (remedies: TRemedies): TRemedies => pagePinned(REMEDIES_KEY, () => remedies);

/** The records the page shows. Ending the page ends its subscription to observed quads. */
export const pageRecords = (): TRecordStore =>
	pagePinned(
		RECORDS_KEY,
		(): TRecordStore => ({ entries: new Map(), listeners: new Set(), unsubscribe: undefined }),
		(store) => store.unsubscribe?.(),
	);

/** Returns the channel to the window that embeds the page, at the deployment's embedder origin `origin`. */
export const pageEmbedder = (origin: string): TEmbedderChannel => pagePinned(EMBEDDER_KEY, () => embedderChannel(window, origin));

/** Returns where the page's views hold the graph presenters they embed. */
export const pagePresenterMount = (): TPresenterMount => pagePinned(PRESENTER_MOUNT_KEY, () => browserPresenterMount(document));

/** Returns the page's blip channel: its ring of `capacity` blips and its pending send, held across its bundles, its clock, and its conduit where
 *  a site serves the page and the page holds one. The page cancels its pending send when it ends. */
export function pageBlips(capacity: number): TBlipChannel {
	const { ring, sending } = pagePinned(
		BLIPS_KEY,
		(): { ring: TBlipRing; sending: TBlipSending } => ({ ring: blipRing(capacity), sending: { cancel: undefined } }),
		(held) => held.sending.cancel?.(),
	);
	return {
		ring,
		sending,
		clock: pageClock(),
		may: (action) => pageAuthorityPort().may(action),
		conduit: hasHydration() && pageHydration().carried() === undefined && hasConduit() ? pageConduit() : undefined,
	};
}

/** Returns the page's hydration element, by its id `id`. */
export const pageHydrationElement = (id: string): THydrationElement => documentHydration(document, id);

/** Returns the step registry the page runs on, held across its bundles, and unread on each new page. */
export const pageRegistry = (): Machine<TRegistryState, TRegistryEvent> => pagePinned(REGISTRY_KEY, () => machine(INITIAL_REGISTRY, registryTransition));

/** Returns the reads of actuality's steps under way, across the page's bundles. The page stops following actuality's signals
 *  when it ends. */
export const registryReads = (): TRegistryReads =>
	pagePinned(
		REGISTRY_READS_KEY,
		(): TRegistryReads => ({ pending: undefined, againQueued: false, unfollow: undefined }),
		(reads) => reads.unfollow?.(),
	);

/** Returns what a read of actuality's steps reads: the registry, the reads under way, the conduit and the stream. */
export const registryScope = (): TReadStepsScope => ({ registry: pageRegistry(), reads: registryReads(), conduit: pageConduit, stream: pageEventStream, device: pageDeviceStore });

/** Returns the status of the page's event stream, which its adapter moves as the stream opens, breaks and closes. */
export const streamStatus = (): Machine<TStreamStatus, TStreamEvent> => pagePinned(STREAM_STATUS_KEY, () => machine(INITIAL_STREAM_STATUS, streamTransition));

/** The reports of the page's event stream, each an event of its status machine. */
const streamReports = (): TStreamReports => {
	const status = streamStatus();
	return {
		opened: () => status.dispatch({ type: STREAM_EVENT.OPENED }),
		broke: () => status.dispatch({ type: STREAM_EVENT.BROKE }),
		closed: () => status.dispatch({ type: STREAM_EVENT.CLOSE }),
	};
};

const installedStream = (): { stream?: TEventStream } => pagePinned(EVENT_STREAM_KEY, () => ({}));

/** Installs the page's stream of actuality's events, read from actuality's stream at `source`. A served page installs it. */
export function installLiveEventStream(source: () => TLiveStreamSource): TEventStream {
	const stream = liveEventStream(source, streamReports());
	installedStream().stream = stream;
	return stream;
}

/** Installs the stream of actuality's events at `url` of the site that served the page, signed under a delegation that allows
 *  following actuality where the page holds one, and reopened after a break after the deployment's delay. */
export const installServedEventStream = (url: string): TEventStream =>
	installLiveEventStream(() => ({
		url,
		actualityId: pageHydration().actualityId(),
		headers: (at) => pageAuthorityPort().readingHeaders(new URL(at, location.href).toString(), FOLLOWS_THE_RUN),
		reconnectDelayMs: pageHydration().settings().streamReconnectAfterMs,
	}));

/** Installs a stream of the events a page carries or a test supplies, and returns it, so the caller adds its events. */
export function installCarriedEventStream(): CarriedEventStream {
	const stream = new CarriedEventStream(streamReports());
	installedStream().stream = stream;
	return stream;
}

/** Whether the page holds an event stream. A page under test that doesn't drive events doesn't install one. */
export const hasEventStream = (): boolean => installedStream().stream !== undefined;

/** Returns the page's event stream. Throws where the page's start, or a test's `setupShuTest`, didn't install one. */
export function pageEventStream(): TEventStream {
	const { stream } = installedStream();
	if (!stream) throw new Error("the page doesn't hold an event stream: the page's start installs one, and a test calls setupShuTest() first");
	return stream;
}

const installedHydration = (): { hydration: THydrationRead | undefined } => pagePinned(HYDRATION_KEY, () => ({ hydration: undefined }));

/** Installs `hydration` as what the page holds of its hydration. The page's start reads it before anything else. */
export function installHydration(hydration: THydrationRead): THydrationRead {
	installedHydration().hydration = hydration;
	return hydration;
}

/** Returns what the page holds of its hydration. Throws where the page's start, or a test's `setupShuTest`, didn't read it. */
export function pageHydration(): THydrationRead {
	const { hydration } = installedHydration();
	if (hydration === undefined) throw new Error("the page doesn't hold its hydration: the page's start reads it, and a test calls setupShuTest() first");
	return hydration;
}

/** Whether the page holds its hydration. A page mounted without it, as a bundle under test, records its blips but doesn't send them. */
export const hasHydration = (): boolean => installedHydration().hydration !== undefined;

const installedAuthority = (): { authority: TAuthority | undefined } => pagePinned(AUTHORITY_PORT_KEY, () => ({ authority: undefined }));

/** Installs `authority` as the reader's authority on the page. The page's start, and a test's `setupShuTest`, install the
 *  authority area's (`page/authority/`). */
export function installAuthority(authority: TAuthority): TAuthority {
	installedAuthority().authority = authority;
	return authority;
}

/** Returns the reader's authority on the page. Throws where the page's start, or a test's `setupShuTest`, didn't install it. */
export function pageAuthorityPort(): TAuthority {
	const { authority } = installedAuthority();
	if (authority === undefined) throw new Error("the page doesn't hold the reader's authority: the page's start installs it, and a test calls setupShuTest() first");
	return authority;
}

const installedConduit = (): { conduit?: TConduit } => pagePinned(CONDUIT_KEY, () => ({}));

/** Installs `conduit` as the page's conduit, in place of the conduit the page holds. A test installs its own. */
export function installConduit(conduit: TConduit): TConduit {
	installedConduit().conduit = conduit;
	return conduit;
}

/** Installs the conduit that calls the site at `basePath`, signed with the page's authority under the action `required`
 *  returns for each method. A served page installs it. */
export function installServedConduit(basePath: string, required: (method: string) => string | undefined): TConduit {
	const prove = (method: string): TProveRequest => pageAuthorityPort().prove(method, required(method));
	const forgetAuthority = (): void => pageAuthorityPort().forget();
	return installConduit(
		new LiveConduit(
			{ prove, actualityId: () => pageHydration().actualityId(), responseTimeoutMs: () => pageHydration().settings().responseTimeoutMs, forgetAuthority },
			conduitHeld(),
			basePath,
			null,
		),
	);
}

/** Installs the conduit of a page that carries a record of actuality, whose calls fail as calls to an unreachable site. */
export const installCarriedConduit = (): TConduit => installConduit(carriedConduit());

/** Installs the page's ports at its start, once it holds its hydration: the reader's authority, and the conduit and event
 *  stream of a page a site serves, whose calls are signed under the action `required` returns for each method and whose
 *  stream is at `streamUrl`, or of a page that carries a record of actuality. */
export function startPage(authority: TAuthority, required: (method: string) => string | undefined, streamUrl: string): void {
	installAuthority(authority);
	if (pageHydration().carried() !== undefined) {
		installCarriedConduit();
		installCarriedEventStream();
	} else {
		installServedConduit("", required);
		installServedEventStream(streamUrl);
	}
}

/** Whether the page holds a conduit. A page mounted without one, as a bundle under test, doesn't send its blips. */
export const hasConduit = (): boolean => installedConduit().conduit !== undefined;

/** Returns the page's conduit. Throws where the page's start, or a test's `setupShuTest`, didn't install one. */
export function pageConduit(): TConduit {
	const { conduit } = installedConduit();
	if (!conduit) throw new Error("the page doesn't hold a conduit: the page's start installs one, and a test calls setupShuTest() first");
	return conduit;
}

/** What the page holds of its calls, across its bundles. */
const conduitHeld = () => pagePinned(CONDUIT_HELD_KEY, initialConduitHeld);

/** Returns when the site last responded to the page, or undefined where it hasn't responded. */
export const lastResponseAt = (): number | undefined => conduitHeld().respondedAt;

/** A machine of the page: its state and its moves are cells the page holds under `key`, so every view in every bundle reads
 *  the state and follows the moves. */
export const sharedMachine = <S, E>(key: string, initial: S, transition: TTransition<S, E>): Machine<S, E> & { readonly state: TSharedCell<S> } =>
	new Machine(new SharedCell(key, initial), new SharedCell<TMove<S, E> | null>(`${key}:moves`, null), transition) as Machine<S, E> & { readonly state: TSharedCell<S> };

/** The page's time cursor, in epoch milliseconds, or null where the page follows actuality as it happens. A view opened at
 *  a moment holds its own cursor. */
export const timeCursor = new SharedCell<number | null>("timeCursor", null);

/** The column key of the pane the reader acts from, or null where the query pane is active. The pane router writes it, and
 *  the ask's context, each view's `isActiveView`, the strip and the graph view's dimming read it. */
export const activePane = new SharedCell<string | null>("activePane", null);

/** What the view the reader acts from states it shows, or null until a view states it. The page writes it from each view's
 *  `CONTEXT_CHANGE`. */
export const pageContext = new SharedCell<TPageContext | null>("pageContext", null);

/** The pane docked along the bottom of the page, or null where a pane isn't docked. The docked pane writes it, and the page
 *  strip opens and closes the pane through it. */
export const dockedPane = new SharedCell<TDockedPane | null>("dockedPane", null);

/** The types the page searches. The actions bar's search writes it, and the page strip offers them beside what it found. */
export const pageTypes = new SharedCell<TPageTypes>("pageTypes", { options: [], selected: "" });

/** What the page's breadcrumb names first: the search the query surface states. The actions bar's search writes it. */
export const pageTrail = new SharedCell<string>("pageTrail", NOTHING_SELECTED_LABEL);

/** What the page reports of itself, which the page strip shows: a failure, a site that didn't respond. */
export const pageStatus = new SharedCell<string>("pageStatus", "");

/** The dropdown values each type's fields offer, by type, as the site returned them and its live quads added to them. */
export const selectValues = new SharedCell<Readonly<Record<string, Record<string, string[]>>>>("selectValues", {});

/** The panes the column strip holds, in its order. The strip writes it. */
export const stripPanes = new SharedCell<ReadonlyArray<TStripPane>>("stripPanes", []);

/** The page the reader has open in the window that embeds shu, as the embedding page last posted it, or null where the
 *  reader doesn't have a page open. */
export const embeddedPageView = new SharedCell<TEmbeddedPageView | null>("embeddedPageView", null);

/** The delegation the embedding page last gave shu's page key, or null where it hasn't given one. */
export const givenDelegation = new SharedCell<TDelegation | null>("givenDelegation", null);
