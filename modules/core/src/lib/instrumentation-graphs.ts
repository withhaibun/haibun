/**
 * The named graphs the engine emits to record its own execution — the `observation/*` family plus
 * SeqPath, Endpoint, facts and variables — as opposed to a feature's domain data. `isInstrumentationGraph`
 * matches the open-ended `observation/*` prefix plus the four non-prefixed built-ins; `INSTRUMENTATION_GRAPHS`
 * is the concrete list for callers that need explicit labels (a store's other types are runtime-discovered).
 *
 * Separate from quad-types.ts to avoid a cycle: it imports working-memory and http-observations, which import quad-types.
 */
import { SHARED_GRAPH } from "./quad-types.js";
import { SEQ_PATH_LABEL } from "./resources.js";
import { FACT_GRAPH, OBSERVATION_GRAPH as RUNTIME_OBSERVATION_GRAPH } from "./working-memory.js";
import { OBSERVATION_GRAPH as HTTP_OBSERVATION_GRAPH } from "./http-observations.js";

const OBSERVATION_PREFIX = "observation/";

// From web-playwright; a literal because core can't import that module (the observation/ prefix covers it anyway).
const VISITED_PAGE_GRAPH = "observation/visited-page";

export type TInstrumentationGraph =
	| typeof FACT_GRAPH
	| typeof SHARED_GRAPH
	| typeof SEQ_PATH_LABEL
	| typeof VISITED_PAGE_GRAPH
	| (typeof RUNTIME_OBSERVATION_GRAPH)[keyof typeof RUNTIME_OBSERVATION_GRAPH]
	| (typeof HTTP_OBSERVATION_GRAPH)[keyof typeof HTTP_OBSERVATION_GRAPH];

export const INSTRUMENTATION_GRAPHS: readonly TInstrumentationGraph[] = [
	...new Set<TInstrumentationGraph>([
		FACT_GRAPH,
		SHARED_GRAPH,
		SEQ_PATH_LABEL,
		VISITED_PAGE_GRAPH,
		...Object.values(RUNTIME_OBSERVATION_GRAPH),
		...Object.values(HTTP_OBSERVATION_GRAPH),
	]),
];

// The instrumentation labels without the observation/ prefix.
const NAMED_INSTRUMENTATION = new Set<string>([FACT_GRAPH, SHARED_GRAPH, SEQ_PATH_LABEL, HTTP_OBSERVATION_GRAPH.ENDPOINT]);

export function isInstrumentationGraph(namedGraph: string): boolean {
	return namedGraph.startsWith(OBSERVATION_PREFIX) || NAMED_INSTRUMENTATION.has(namedGraph);
}
