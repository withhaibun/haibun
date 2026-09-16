/**
 * A page reads the run's steps once and holds them, and reads them again each time the run signals that the steps its
 * registry holds changed: a run that stands up another host adds that host's steps while a page is open.
 */
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { STEPS_CHANGED } from "@haibun/core/schema/protocol.js";
import { eventStream } from "./event-stream.js";
import { rereadStepList } from "./rpc-registry.js";

/** Read the run's steps again each time the run signals they changed, and each time the stream comes back after a break,
 *  during which a change reached no page; then call `reread`. Returns the unsubscribe. */
export function followStepChanges(reread: () => Promise<void> | void): () => void {
	const readAgain = () => {
		void rereadStepList()
			.then(reread)
			.catch((err) => failFastOrLog("[steps-changes] the run's steps were not read again:", err));
	};
	const stopSignals = eventStream().subscribe(readAgain, (event) => event.kind === "control" && event.signal === STEPS_CHANGED);
	const stopReconnections = eventStream().reconnected(readAgain);
	return () => {
		stopSignals();
		stopReconnections();
	};
}
