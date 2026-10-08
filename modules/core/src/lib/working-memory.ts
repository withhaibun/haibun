/**
 * Working memory: typed fact assertions in the world's quad store.
 *
 * This module writes and reads the runtime's facts. The quad store holds every fact under
 * a named graph, and the predicate field types the fact. `assertFact` writes a fact.
 * `queryFacts` and `getFact` read facts.
 *
 * Named-graph convention:
 *
 *   observation/<subtype>   runtime metrics and counters (this module)
 *   variables               feature-variables (see SHARED_GRAPH in feature-variables.ts)
 *   <persistedAs>           domain-registered topology graphs (e.g. "Email", "Person")
 *
 * Sub-named-graphs this module defines:
 *   observation/step-usage     step-execution counts keyed by stepperName.actionName
 *   observation/runtime-flag   boolean/scalar runtime flags keyed by flag name
 *   observation/event          named for eventLogger emissions. The eventLogger doesn't write this graph.
 */
import type { TWorld } from "./world.js";
import type { IQuadStore, TQuad, TQuadPattern } from "./quad-types.js";

export const OBSERVATION_GRAPH = { STEP_USAGE: "observation/step-usage", RUNTIME_FLAG: "observation/runtime-flag", EVENT: "observation/event" } as const;

/**
 * The named graph that holds step products. The dispatcher asserts a product when a step
 * declares `productsDomain` or `productsDomains`. Each fact's predicate is the domain key,
 * and its object is the product value. Its subject is the id that `factIdOf` builds from the
 * step's seqPath and, under `productsDomains`, the product's field.
 */
export const FACT_GRAPH = "facts";

/**
 * Asserts one typed fact into a named graph.
 *
 * It writes the quad `subject=identity, predicate=domain, object=object, namedGraph`.
 * The named graph types the facts it holds (e.g. `observation/step-usage`). The domain is
 * the predicate. It names a structural attribute within that graph (e.g. `count`). The
 * identity is the observed entity's stable id.
 */
export async function assertFact(world: TWorld, domain: string, identity: string, object: unknown, namedGraph: string): Promise<void> {
	const store: IQuadStore = world.shared.getStore();
	await store.set(identity, domain, object, namedGraph);
}

/**
 * Queries the facts of a domain in a named graph and returns the matching quads. A `pattern`
 * narrows the query to an exact subject, an exact object or both.
 */
export function queryFacts(world: TWorld, domain: string, namedGraph: string, pattern?: Omit<TQuadPattern, "predicate" | "namedGraph">): Promise<TQuad[]> {
	const store: IQuadStore = world.shared.getStore();
	return store.query({ ...pattern, predicate: domain, namedGraph });
}

/**
 * Returns the most recent value of the fact for a (domain, identity) pair in a named graph, or
 * undefined where the store doesn't hold one.
 */
export function getFact(world: TWorld, domain: string, identity: string, namedGraph: string): Promise<unknown | undefined> {
	const store: IQuadStore = world.shared.getStore();
	return store.get(identity, domain, namedGraph);
}
