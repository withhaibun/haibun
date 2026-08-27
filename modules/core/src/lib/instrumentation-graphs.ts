/**
 * The named graphs the engine emits to record its own execution — the `observation/*` family plus the persisted
 * instrumentation types (SeqPath, Endpoint, the HTTP observation records, visited pages, facts and variables) — as
 * opposed to a feature's domain data. What a run did, said and produced is all of that kind: a reader looking at a
 * feature's data is not looking for the run's own record of itself. `isInstrumentationGraph` matches the open-ended `observation/*` prefix plus the
 * named entries; `INSTRUMENTATION_GRAPHS` is the one concrete list (a store's other types are runtime-discovered).
 *
 * Separate from quad-types.ts to avoid a cycle: it imports working-memory and http-observations, which import quad-types.
 */
import { SHARED_GRAPH } from "./quad-types.js";
import { READING_LABEL, SEQ_PATH_LABEL } from "./resources.js";
import { FACT_GRAPH, OBSERVATION_GRAPH as RUNTIME_OBSERVATION_GRAPH } from "./working-memory.js";
import { ENDPOINT_LABEL, HTTP_REQUEST_LABEL, HTTP_CLIENT_LABEL, HTTP_HOST_LABEL } from "./http-observations.js";
import { LOG_MESSAGE_LABEL } from "./log-message.js";
import { RUN_ARTIFACT_LABEL } from "./run-artifact.js";

const OBSERVATION_PREFIX = "observation/";

/** A page the browser navigated to. Declared here (its writer is web-playwright, which imports this) so the label has
 *  one definition core can also read for the hidden-by-default set. */
export const VISITED_PAGE_LABEL = "VisitedPage";

export type TInstrumentationGraph =
	| typeof FACT_GRAPH
	| typeof SHARED_GRAPH
	| typeof SEQ_PATH_LABEL
	| typeof LOG_MESSAGE_LABEL
	| typeof RUN_ARTIFACT_LABEL
	| typeof READING_LABEL
	| typeof VISITED_PAGE_LABEL
	| typeof ENDPOINT_LABEL
	| typeof HTTP_REQUEST_LABEL
	| typeof HTTP_CLIENT_LABEL
	| typeof HTTP_HOST_LABEL
	| (typeof RUNTIME_OBSERVATION_GRAPH)[keyof typeof RUNTIME_OBSERVATION_GRAPH];

export const INSTRUMENTATION_GRAPHS: readonly TInstrumentationGraph[] = [
	...new Set<TInstrumentationGraph>([
		FACT_GRAPH,
		SHARED_GRAPH,
		SEQ_PATH_LABEL,
		LOG_MESSAGE_LABEL,
		RUN_ARTIFACT_LABEL,
		READING_LABEL,
		VISITED_PAGE_LABEL,
		ENDPOINT_LABEL,
		HTTP_REQUEST_LABEL,
		HTTP_CLIENT_LABEL,
		HTTP_HOST_LABEL,
		...Object.values(RUNTIME_OBSERVATION_GRAPH),
	]),
];

// The instrumentation labels without the observation/ prefix, derived from the one list above.
const NAMED_INSTRUMENTATION = new Set<string>(INSTRUMENTATION_GRAPHS.filter((g) => !g.startsWith(OBSERVATION_PREFIX)));

export function isInstrumentationGraph(namedGraph: string): boolean {
	return namedGraph.startsWith(OBSERVATION_PREFIX) || NAMED_INSTRUMENTATION.has(namedGraph);
}
