/**
 * Route step-end hypermedia products to pane operations — the intent-bearing ones, each acted on exactly once.
 *
 * Three rules keep views under the person's control while live runs still drive the UI:
 *
 * 1. TRACE SUBSTEPS ARE NOT INTENT. A hidden trace-level substep (isSubStep → level "trace", the same level the log
 *    view hides) is infrastructure — a hidden substep or a panel's own data refetch can carry view markers in its
 *    products without anyone asking for that view. Only the steps a person can see in the log (level
 *    "info") act as view commands.
 *
 * 2. EACH EVENT ACTS ONCE. The SSE server replays its whole history to every (re)connecting client (tagged `replay`
 *    at the transport); replays still open panes — that is how a page connecting mid-run picks up the views a CLI
 *    run has opened — but the `routed` id set makes any re-delivery of an already-acted-on event inert.
 *
 * 3. A CLOSE OUTLASTS THE PAST. When the person closes a pane, the close is watermarked with the newest event time
 *    seen (clock-free — both sides of the comparison are server event times) and persisted by the caller. An open
 *    op applies only when its event is STRICTLY NEWER than the pane's watermark: history — including a previous
 *    run on a long-lived server, and any reload's replay — can never resurrect a closed view, while a freshly run
 *    step (a new decision) reopens it.
 *
 * Within one batch the LATEST op per pane wins, keyed by pane identity; close/open order across DISTINCT panes is
 * preserved by Map insertion order.
 */
import type { THaibunEvent, THypermediaProducts } from "@haibun/core/schema/protocol.js";
import { parseAffordanceProduct } from "./affordance-products.js";
import type { TAffordanceView } from "./affordance-products.js";
import type { TEvent } from "./event-stream.js";

export type TPaneOp =
	| { op: "dismiss"; view: string }
	| { op: "component"; tag: string; label: string; data: Record<string, unknown> }
	| { op: "views-picker"; views: TAffordanceView[]; label: string };

export type TPaneRouteState = {
	/** Event ids already acted on this session — a re-delivered event is inert. */
	routed: Set<string>;
	/** Pane key → event-time watermark of the person's dismissal. Only a strictly newer event reopens the pane. */
	dismissedAt: Map<string, number>;
	/** Newest event timestamp seen — the clock-free stamp a dismissal records. */
	maxSeen: number;
};

/** Fresh routing state, seeded with persisted dismissal watermarks (so a close survives a reload). */
export function createPaneRouteState(dismissed: Record<string, number> = {}): TPaneRouteState {
	return { routed: new Set(), dismissedAt: new Map(Object.entries(dismissed)), maxSeen: 0 };
}

/** Record the person's dismissal of a pane at the newest event time seen. Returns the serializable watermark map for the caller to persist. */
export function recordPaneDismissal(state: TPaneRouteState, paneKey: string): Record<string, number> {
	state.dismissedAt.set(paneKey, state.maxSeen);
	return Object.fromEntries(state.dismissedAt);
}

/** Whether a batch is still the connect-time replay and nothing else. What a page STARTS on is what the replay
 *  opens, so a caller that treats the opening view differently (the index gives it the room) needs to know when the
 *  replay is over. The first live event ends it, not the first batch: batches are one animation frame each, and a
 *  history of any size arrives over several, so a view being replayed can land in the second or the tenth. */
export function isReplayOnly(events: readonly { replay?: true }[]): boolean {
	return events.every((e) => e.replay === true);
}

export function paneOpsFor(events: TEvent[], state: TPaneRouteState, uiComponentByType: (type: string) => string | undefined): Map<string, TPaneOp> {
	const ops = new Map<string, TPaneOp>();
	const openUnlessDismissed = (key: string, timestamp: number, op: TPaneOp): void => {
		const watermark = state.dismissedAt.get(key);
		if (watermark !== undefined && timestamp <= watermark) return; // the person closed this pane after that event happened
		ops.set(key, op);
	};
	for (const event of events) {
		const e = event as THaibunEvent & { products?: THypermediaProducts };
		if (typeof e.timestamp === "number" && e.timestamp > state.maxSeen) state.maxSeen = e.timestamp;
		if (e.kind !== "lifecycle" || e.type !== "step" || e.stage !== "end" || e.status !== "completed" || !e.products) continue;
		if (e.level === "trace") continue; // a hidden substep is infrastructure, not a person's intent (rule 1)
		if (typeof e.id === "string") {
			if (state.routed.has(e.id)) continue;
			state.routed.add(e.id);
		}
		const action = parseAffordanceProduct(e.products);
		if (action.kind === "none") continue;
		const ts = typeof e.timestamp === "number" ? e.timestamp : state.maxSeen;
		if (action.kind === "close") ops.set(action.view, { op: "dismiss", view: action.view });
		else if (action.kind === "open-component") openUnlessDismissed(action.component, ts, { op: "component", tag: action.component, label: action.label, data: action.products });
		else if (action.kind === "show-views") openUnlessDismissed("views", ts, { op: "views-picker", views: action.views, label: action.label });
	}
	return ops;
}
