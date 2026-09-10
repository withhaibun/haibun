/**
 * `setupShuTest`: the single way every shu test installs its services. One
 * call inside `beforeEach` (or once at suite level) installs a `Conduit` and
 * an `EventStream`, returns handles for the test to drive scripted events
 * and inspect dispatch params, and runs cleanup on teardown.
 *
 * Tests pass a `dispatch` function that returns wire results per
 * `(method, params)`; throwing inside it is the loud-failure signal for "no
 * fixture configured", and the throw surfaces verbatim through `conduit()`
 * call sites. Tests `emit` events to drive lifecycle/log subscribers.
 *
 * Every test sets up the same way, with no setup-by-side-effect; forgetting
 * the call makes the first `conduit()` or `eventStream()` throw a precise
 * "no Conduit installed" / "no EventStream installed" error naming what
 * was missed.
 */

import { setConduit, resetConduit, type Conduit, type TLink, type TRepresentation, type TStreamChunk } from "./hypermedia.js";

// ─── The conduit a test installs ─────────────────────────────────────────────

/** A test's answers, by `(method, params)`. Throwing inside it signals "no fixture for this call": `TestConduit` surfaces the throw so a test fails loudly, naming the method nothing answered. */
export type TDispatch = (method: string, params: Record<string, unknown>) => unknown | Promise<unknown>;

/** A `Conduit` answering from a function a test supplies, so nothing under test knows it is not talking to a server. */
export class TestConduit implements Conduit {
	constructor(private readonly dispatch: TDispatch) {}

	async follow<T = TRepresentation>(link: TLink, _why: string): Promise<T> {
		const result = await this.dispatch(link.method, link.params ?? {});
		return result as T;
	}

	async followStream(
		link: TLink,
		onChunk: (chunk: TStreamChunk) => void,
		opts: { why: string; signal?: AbortSignal; onStart?: (seqPath: number[]) => void },
	): Promise<{ seqPath: number[] }> {
		const seqPath = [0];
		opts.onStart?.(seqPath);
		const result = await this.dispatch(link.method, link.params ?? {});
		// A chunk carrying an error ends the stream, as it ends one from a service: a caller reads the same failure
		// whichever conduit is installed.
		for (const chunk of (Array.isArray(result) ? result : [result]) as TStreamChunk[]) {
			if (chunk?.error) throw new Error(String(chunk.error));
			onChunk(chunk);
		}
		return { seqPath };
	}

	group<T>(_why: string, fn: (g: Conduit) => Promise<T>): Promise<T> {
		return fn(this);
	}
}

import { setEventStream, resetEventStream, SerializedEventStream, type TEvent } from "./event-stream.js";
import { resetRunSources, setDeviceStore, MemoryDeviceStore } from "./client-cache/index.js";

export type TShuTestConfig = {
	/** Optional dispatch for in-test RPCs. Default throws on every call, naming the unconfigured method, tests opt in by supplying a function that returns wire results for the methods they exercise. */
	dispatch?: TDispatch;
};

export type TShuTestHandle = {
	/** Drive a scripted event into the installed `EventStream`. Components subscribed via `eventStream()` see it as if it had arrived over SSE. */
	emit: (event: TEvent) => void;
	/** Tear down both services. Call from `afterEach` (or rely on the next `beforeEach`'s `setupShuTest` overwriting them: both are valid). */
	teardown: () => void;
	/** The `TestConduit` instance installed under `conduit()`. Exposed for assertions that need to swap the dispatch mid-test or read the instance identity. */
	conduit: TestConduit;
	/** The `SerializedEventStream` instance installed under `eventStream()`. Exposed for assertions that need its `totalRecorded()` or to inspect identity. */
	eventStream: SerializedEventStream;
};

/** The two steps the entity surface calls, as `step.list` answers them: the fixture every entity test installs. */
export const ENTITY_STEP_LIST = {
	steps: [
		{ method: "GraphStepper-getIndividualWithEdges", stepperName: "GraphStepper", stepName: "getIndividualWithEdges", pattern: "get vertex {label} {id}", params: {} },
		{ method: "ResourcesStepper-annotations", stepperName: "ResourcesStepper", stepName: "annotations", pattern: "get annotations for {label} {id}", params: {} },
	],
	domains: {},
	concerns: { persisted: {}, references: {} },
};

/** A dispatch over the entity surface: `step.list` answers with {@link ENTITY_STEP_LIST}, the two entity steps route
 *  to the given answerers (annotations defaults to none), and anything else throws: the loud-failure signal. */
export function makeEntityDispatch(over: { entity: () => unknown; annotations?: () => unknown }): TDispatch {
	return (method) => {
		if (method === "step.list") return ENTITY_STEP_LIST;
		if (method === "GraphStepper-getIndividualWithEdges") return over.entity();
		if (method === "ResourcesStepper-annotations") return over.annotations ? over.annotations() : { annotations: [] };
		throw new Error(`unexpected ${method}`);
	};
}

/** jsdom implements no media queries, so a component that asks the viewport a question (the strip asks whether it is
 *  narrow or portrait before it lays panes out) throws there and nowhere else. Install the query API the browser always
 *  has, answering "no match": a jsdom window has no orientation and no width to match on. `setupShuTest` calls this;
 *  a DOM test that installs no services calls it directly. */
export function installTestMediaQueries(): void {
	const w = globalThis as { matchMedia?: (q: string) => unknown };
	if (w.matchMedia) return;
	w.matchMedia = (media: string) => ({
		media,
		matches: false,
		onchange: null,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		addListener: () => undefined,
		removeListener: () => undefined,
		dispatchEvent: () => false,
	});
}

export function setupShuTest(config: TShuTestConfig = {}): TShuTestHandle {
	installTestMediaQueries();
	const dispatch: TDispatch =
		config.dispatch ??
		((method) => {
			throw new Error(
				`setupShuTest: no dispatch configured for "${method}". Pass setupShuTest({ dispatch: (method, params) => ... }) and return a wire result for the methods this test exercises.`,
			);
		});
	const conduit = new TestConduit(dispatch);
	const eventStream = new SerializedEventStream();
	setConduit(conduit);
	setEventStream(eventStream);
	// The run sources are page-wide singletons (one per level, pinned on globalThis): each test starts them afresh over a
	// memory store, so a source grown by one test's live events is not the next test's.
	resetRunSources();
	setDeviceStore(new MemoryDeviceStore());
	return {
		emit: (event) => eventStream.emit(event),
		teardown: () => {
			resetRunSources();
			resetConduit();
			resetEventStream();
			eventStream.close();
		},
		conduit,
		eventStream,
	};
}
