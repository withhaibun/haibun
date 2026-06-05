/**
 * `setupShuTest` — the single way every shu test installs its services. One
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

import { setConduit, resetConduit, SerializedConduit, type TDispatch } from "./hypermedia.js";
import { setEventStream, resetEventStream, SerializedEventStream, type TEvent } from "./event-stream.js";

export type TShuTestConfig = {
	/** Optional dispatch for in-test RPCs. Default throws on every call, naming the unconfigured method — tests opt in by supplying a function that returns wire results for the methods they exercise. */
	dispatch?: TDispatch;
};

export type TShuTestHandle = {
	/** Drive a scripted event into the installed `EventStream`. Components subscribed via `eventStream()` see it as if it had arrived over SSE. */
	emit: (event: TEvent) => void;
	/** Tear down both services. Call from `afterEach` (or rely on the next `beforeEach`'s `setupShuTest` overwriting them — both are valid). */
	teardown: () => void;
	/** The `SerializedConduit` instance installed under `conduit()`. Exposed for assertions that need to swap the dispatch mid-test or read the instance identity. */
	conduit: SerializedConduit;
	/** The `SerializedEventStream` instance installed under `eventStream()`. Exposed for assertions that need its `totalRecorded()` or to inspect identity. */
	eventStream: SerializedEventStream;
};

export function setupShuTest(config: TShuTestConfig = {}): TShuTestHandle {
	const dispatch: TDispatch =
		config.dispatch ??
		((method) => {
			throw new Error(
				`setupShuTest: no dispatch configured for "${method}". Pass setupShuTest({ dispatch: (method, params) => ... }) and return a wire result for the methods this test exercises.`,
			);
		});
	const conduit = new SerializedConduit(dispatch);
	const eventStream = new SerializedEventStream();
	setConduit(conduit);
	setEventStream(eventStream);
	return {
		emit: (event) => eventStream.emit(event),
		teardown: () => {
			resetConduit();
			resetEventStream();
			eventStream.close();
		},
		conduit,
		eventStream,
	};
}
