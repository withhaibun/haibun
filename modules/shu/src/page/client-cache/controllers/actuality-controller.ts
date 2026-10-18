/**
 * Actuality as a view reads it: one reading per level, shared by every view at that level, and a view's reading as a Lit
 * controller that derives the view's window from the reading's version (PF29).
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { SHU_TAG } from "../../../domains/elements.js";
import { INITIAL_WINDOW_SIZE, PAGE_SETTING_KEY, WindowSizeSchema } from "../../domains/settings.js";
import { storedSetting, windowRows } from "../../derivations/settings.js";
import { pageClock, pageEventStream, pagePreferences, timeCursor } from "../../root.js";
import { pageActualityGraph, selectValuesFor } from "../../controllers/read-controller.js";
import { componentOfView, declaredViews } from "../../controllers/catalog-controller.js";
import { graphActualitySources, actualityRegistry, actualityReport } from "../root.js";
import type { ActualitySource } from "../ports.js";
import { ACTUALITY_WINDOW_SIZE } from "../derivations/actuality-rows.js";
import * as Sources from "../pipelines/actuality-sources.js";
import * as ViewsShown from "../pipelines/views-shown.js";
import { currentExecution, noteExecution, readingExecution, subscribeExecutionSwitch } from "./device-controller.js";
import { holdOnDevice } from "./held-actualities-controller.js";

export type { ActualitySource, TEventRecord, TActualityExtent } from "../ports.js";

/** How long a burst of changes is collected before the window is read again. */
const RE_READ_AFTER_MS = 250;

/** What a reading of actuality reads and writes on this page. */
export const actualitySourceScope = (): Sources.TActualitySourceScope => ({
	registry: actualityRegistry(),
	graph: pageActualityGraph,
	executions: { chosen: currentExecution, reading: readingExecution, observe: noteExecution, onSwitch: subscribeExecutionSwitch },
	hold: holdOnDevice,
	events: pageEventStream(),
	clock: pageClock(),
	setCursor: (moment) => timeCursor.set(moment),
	pageSize: windowRows(storedSetting(`<${SHU_TAG.WINDOW_SIZE}>`, WindowSizeSchema, pagePreferences().read(SHU_TAG.WINDOW_SIZE, PAGE_SETTING_KEY), INITIAL_WINDOW_SIZE)),
	report: actualityReport,
});

/** Stops reading an actuality the views don't show, and drops it, so the next view to read at that level reads afresh. */
function release(key: string): void {
	const sources = graphActualitySources();
	const held = sources.get(key);
	if (held === undefined) return;
	sources.delete(key);
	held.close();
}

/** Returns actuality as a view reads it at `level`. A reading is its level and whether it shows the steps run to carry
 *  other steps out: two views reading the same share one, and a view reading substeps reads one of its own rather
 *  than filtering one. */
export function graphActualitySource(level: THaibunLogLevel, substeps: boolean): ActualitySource {
	const key = substeps ? `${level}+substeps` : level;
	const sources = graphActualitySources();
	const held = sources.get(key);
	if (held) return held;
	const made = Sources.makeGraphActualitySource(actualitySourceScope(), level, {
		size: ACTUALITY_WINDOW_SIZE,
		reReadAfterMs: RE_READ_AFTER_MS,
		substeps,
		release: () => release(key),
	});
	sources.set(key, made);
	return made;
}

/** The readings of actuality the views read, in level order. */
export const actualitySources = (): ActualitySource[] => Sources.actualitySources(actualityRegistry());

/** Calls `fn` with each reading as it is made. Returns the unsubscribe. */
export const subscribeActualitySources = (fn: (source: ActualitySource) => void): (() => void) => Sources.subscribeActualitySources(actualityRegistry(), fn);

/** The moment actuality is read around, or undefined while the newest records are being followed. */
export const actualityReadingAt = (): number | undefined => Sources.actualityReadingAt(actualityRegistry());

/** When actuality the page reads starts and ends, over every level read. */
export const actualitySpan = (): { first: number; last: number } => Sources.actualitySpan(actualityRegistry());

/** Whether an instant is actuality's live edge: at or past its newest row. */
export const atLiveEdge = (instant: number): boolean => Sources.atLiveEdge(actualityRegistry(), instant);

/** Reads actuality around a moment on every reading a view reads by; `null` follows the newest records again. */
export const readActualityAt = (at: number | null): Promise<void> => Sources.readActualityAt(actualityRegistry(), at);

/** The elements of the views the execution being read has shown, in the order the site declares the views. */
export const viewsShown = (): Promise<string[]> => ViewsShown.viewsShown({ selectValues: selectValuesFor, declared: declaredViews, componentOf: componentOfView });

/**
 * A view's reading of actuality. The view's window derives from the reading once per change of it: the controller holds
 * the reading's version it derived at, and derives again only where the reading's version differs, so a render for any
 * other reason, a move of the time cursor among them, reads the window it holds (PF29).
 */
export class ActualityController<T> implements ReactiveController {
	#source: ActualitySource | undefined;
	#unsubscribe: (() => void) | undefined;
	#version = -1;
	#derived: T | undefined;

	/** `derive` returns the view's window from the reading. */
	constructor(
		private readonly host: ReactiveControllerHost,
		private readonly derive: (source: ActualitySource) => T,
	) {
		host.addController(this);
	}

	/** Reads actuality at `level`, letting go of the reading held before. Returns the reading. */
	read(level: THaibunLogLevel, substeps: boolean): ActualitySource {
		this.#unsubscribe?.();
		const source = graphActualitySource(level, substeps);
		this.#source = source;
		this.#version = -1;
		this.#unsubscribe = source.subscribe(() => this.host.requestUpdate());
		void source.ready().then(() => this.host.requestUpdate());
		return source;
	}

	/** The reading the view reads. */
	get source(): ActualitySource {
		if (this.#source === undefined) throw new Error("a view read its reading of actuality before it read one");
		return this.#source;
	}

	/** The view's window, derived again only where the reading's version differs from the one of its last derivation. */
	get derived(): T {
		const source = this.source;
		if (this.#derived === undefined || this.#version !== source.version) {
			this.#derived = this.derive(source);
			this.#version = source.version;
		}
		return this.#derived;
	}

	hostDisconnected(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
	}
}
