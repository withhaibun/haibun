/**
 * The page's composition root. It installs each of the page's ports once per page, and every bundle on the page reads the
 * installed port, since a bundle that loads this module holds its own copy of it.
 */
import { pagePinned } from "./adapters/page-held.js";
import { SharedCell } from "./adapters/shared-cell.js";
import { Machine, machine, type TMove, type TTransition } from "@haibun/core/lib/machine.js";
import type { TClipboard, TClock, TConduit, TElements, TPageObservers, TEventStream, TPreferences, TSharedCell, TStreamReports } from "./ports.js";
import type { TDockedPane, TPageTypes, TStripPane } from "./domains/page-state.js";
import { NOTHING_SELECTED_LABEL, type TPageContext } from "../schemas.js";
import { DELEGATIONS_READ_METHOD } from "@haibun/core/lib/authority-types.js";
import { SHOW_STEPS_ACTION, SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";
import type { TProveRequest } from "@haibun/core/lib/rpc-wire.js";
import { initialConduitHeld, LiveConduit } from "./adapters/live-conduit.js";
import { cookiePreferences } from "./adapters/prefs-cookie.js";
import { browserClock } from "./adapters/clock.js";
import { browserClipboard } from "./adapters/clipboard.js";
import { browserElements } from "./adapters/elements.js";
import { browserObservers } from "./adapters/page-observers.js";
import { liveEventStream, type TLiveStreamSource } from "./adapters/live-event-stream.js";
import { CarriedEventStream } from "./adapters/carried-event-stream.js";
import { FOLLOWS_THE_RUN } from "@haibun/core/lib/actions.js";
import { deploymentMs, findStep, hydratedActualityId, responseTimeoutMs } from "../rpc-registry.js";
import { forgetPageAuthority, keyHeaders, pageAuthorityReady, readingHeaders, signedHeaders } from "../page-key.js";
import { INITIAL_STREAM_STATUS, STREAM_EVENT, streamTransition, type TStreamEvent, type TStreamStatus } from "./machines/event-stream.js";

const PREFERENCES_KEY = "__SHU_PREFERENCES__";
const CLOCK_KEY = "__SHU_CLOCK__";
const CLIPBOARD_KEY = "__SHU_CLIPBOARD__";
const ELEMENTS_KEY = "__SHU_ELEMENTS__";
const OBSERVERS_KEY = "__SHU_OBSERVERS__";
const EVENT_STREAM_KEY = "__SHU_EVENT_STREAM__";
const STREAM_STATUS_KEY = "__SHU_STREAM_STATUS__";
const CONDUIT_KEY = "__SHU_CONDUIT__";
const CONDUIT_HELD_KEY = "__SHU_CONDUIT_HELD__";

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
	installLiveEventStream(() => ({ url, actualityId: hydratedActualityId(), headers: (at) => readingHeaders(at, FOLLOWS_THE_RUN), reconnectDelayMs: deploymentMs("streamReconnectAfterMs") }));

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

const installedConduit = (): { conduit?: TConduit } => pagePinned(CONDUIT_KEY, () => ({}));

/** Installs `conduit` as the page's conduit, in place of the conduit the page holds. A test installs its own. */
export function installConduit(conduit: TConduit): TConduit {
	installedConduit().conduit = conduit;
	return conduit;
}

/**
 * Returns how a call of `method` from this page is proven. A call of a step is signed with the page's key, under a
 * delegation that allows the action the step requires. The read of the page's delegations proves the key alone, since the
 * page reads its delegations through it. A call for which the page doesn't hold a delegation carries its headers as they
 * are, and the deployment may allow it without a delegation.
 */
function provingFor(method: string): TProveRequest {
	return async (request) => {
		if (method === DELEGATIONS_READ_METHOD) return await keyHeaders(request);
		// The page reads its steps through discovery, so discovery requires the one action the page holds without a read.
		const required = method === SHOW_STEPS_METHOD ? SHOW_STEPS_ACTION : findStep(method)?.capability;
		if (!required) return request.headers;
		// A call waits for the page's authority, which the page reads at its start.
		await pageAuthorityReady();
		return (await signedHeaders({ ...request, action: required })) ?? request.headers;
	};
}

/** Installs the conduit that calls the site at `basePath`, signed with the page's authority. A served page installs it. */
export const installServedConduit = (basePath: string): TConduit =>
	installConduit(new LiveConduit({ prove: provingFor, actualityId: hydratedActualityId, responseTimeoutMs, forgetAuthority: forgetPageAuthority }, conduitHeld(), basePath, null));

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

/** The panes the column strip holds, in its order. The strip writes it. */
export const stripPanes = new SharedCell<ReadonlyArray<TStripPane>>("stripPanes", []);
