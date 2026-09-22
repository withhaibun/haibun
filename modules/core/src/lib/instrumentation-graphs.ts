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

/** The instrumentation graphs by name. A graph whose name starts with the observation prefix is instrumentation whether or not this set contains it. */
const NAMED_INSTRUMENTATION = new Set<string>([FACT_GRAPH, SHARED_GRAPH, ...Object.values(RUNTIME_OBSERVATION_GRAPH)]);

export function isInstrumentationGraph(namedGraph: string): boolean {
	return namedGraph.startsWith(OBSERVATION_PREFIX) || NAMED_INSTRUMENTATION.has(namedGraph);
}
