/**
 * Working memory — typed fact assertions backed by the world's quad store.
 *
 * One fact carrier for the runtime. Every fact lives in the quad store under a
 * named graph; the predicate field types it. `assertFact` writes; `queryFacts` reads.
 *
 * Named-graph convention:
 *
 *   observation/<subtype>   runtime metrics and counters (this module)
 *   variables               feature-variables (see SHARED_GRAPH in feature-variables.ts)
 *   <vertexLabel>           domain-registered topology graphs (e.g. "Email", "Person")
 *
 * The `observation/` prefix matches the existing convention in http-observations.ts
 * (observation/route, observation/shu-service, observation/external) so all runtime
 * observations live under one namespace and can be queried uniformly.
 *
 * Sub-named-graphs introduced by this module:
 *   observation/step-usage     step-execution counts keyed by stepperName.actionName
 *   observation/http-host      HTTP host tally keyed by hostname
 *   observation/http-request   HTTP request observations keyed by request id
 *   observation/runtime-flag   boolean/scalar runtime flags keyed by flag name
 *   observation/event          eventLogger emissions, predicate = event domain
 */
import type { TWorld } from "./world.js";
import type { IQuadStore, TQuad, TQuadPattern } from "./quad-types.js";

export const OBSERVATION_GRAPH = {
	STEP_USAGE: "observation/step-usage",
	HTTP_HOST: "observation/http-host",
	HTTP_REQUEST: "observation/http-request",
	RUNTIME_FLAG: "observation/runtime-flag",
	EVENT: "observation/event",
} as const;

/**
 * Named graph holding step-product assertions auto-asserted by the dispatcher
 * when a step declares `productsDomain` or `productsDomains`. Each fact's predicate is
 * the domain key; subject is the step's seqPath; object is the product value.
 */
export const FACT_GRAPH = "facts";

/**
 * Assert a single typed fact into a named graph.
 *
 * Maps to a quad write:  `subject=identity, predicate=domain, object=object, namedGraph`.
 * The named graph types the bucket (e.g. `observation/step-usage`); the domain (predicate)
 * is the structural attribute within it (e.g. `count`); the identity is the observed
 * entity's stable id.
 */
export async function assertFact(world: TWorld, domain: string, identity: string, object: unknown, namedGraph: string): Promise<void> {
	const store: IQuadStore = world.shared.getStore();
	await store.set(identity, domain, object, namedGraph);
}

/**
 * Query facts of a domain. Returns the matching quads. Pass an explicit `pattern`
 * to narrow further (subject prefix, etc.) — forwarded to the underlying store.
 */
export function queryFacts(world: TWorld, domain: string, namedGraph: string, pattern?: Omit<TQuadPattern, "predicate" | "namedGraph">): Promise<TQuad[]> {
	const store: IQuadStore = world.shared.getStore();
	return store.query({ ...pattern, predicate: domain, namedGraph });
}

/**
 * Read a single fact's most recent value for a (domain, identity) pair, or undefined.
 */
export function getFact(world: TWorld, domain: string, identity: string, namedGraph: string): Promise<unknown | undefined> {
	const store: IQuadStore = world.shared.getStore();
	return store.get(identity, domain, namedGraph);
}

/**
 * Remove every fact matching a domain (and optionally identity) from a named graph.
 * Used for runtime resets between features.
 */
export async function retractFacts(world: TWorld, domain: string, namedGraph: string, identity?: string): Promise<void> {
	const store: IQuadStore = world.shared.getStore();
	await store.remove({ subject: identity, predicate: domain, namedGraph });
}
