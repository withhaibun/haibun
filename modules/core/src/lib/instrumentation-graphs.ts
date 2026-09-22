/**
 * The named graphs the engine emits to record its own execution that aren't persisted types: the `observation/*`
 * family, the facts and the shared variables. A persisted type that records the run's own execution declares
 * `topology.instrumentation` instead, so this list holds only the graphs without a topology to declare it.
 *
 * Separate from quad-types.ts to avoid a cycle: it imports working-memory, which imports quad-types.
 */
import { SHARED_GRAPH } from "./quad-types.js";
import { FACT_GRAPH, OBSERVATION_GRAPH as RUNTIME_OBSERVATION_GRAPH } from "./working-memory.js";

const OBSERVATION_PREFIX = "observation/";

type TInstrumentationGraph = typeof FACT_GRAPH | typeof SHARED_GRAPH | (typeof RUNTIME_OBSERVATION_GRAPH)[keyof typeof RUNTIME_OBSERVATION_GRAPH];

const INSTRUMENTATION_GRAPHS: readonly TInstrumentationGraph[] = [...new Set<TInstrumentationGraph>([FACT_GRAPH, SHARED_GRAPH, ...Object.values(RUNTIME_OBSERVATION_GRAPH)])];

// The graphs without the observation/ prefix, derived from the one list above.
const NAMED_INSTRUMENTATION = new Set<string>(INSTRUMENTATION_GRAPHS.filter((g) => !g.startsWith(OBSERVATION_PREFIX)));

export function isInstrumentationGraph(namedGraph: string): boolean {
	return namedGraph.startsWith(OBSERVATION_PREFIX) || NAMED_INSTRUMENTATION.has(namedGraph);
}
