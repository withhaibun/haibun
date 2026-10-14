/**
 * store-protocol: the delegated store surface. The server (an `/rpc` method family) and the client
 * (RemoteQuadStore) share it. It serves the IQuadStore methods as `store.<method>` protocol calls, so a
 * sibling instance can keep its records in this instance's store. The surface is delegated and never
 * public. Each method requires the `store.read` or the `store.write` capability. The surface gives a
 * trusted delegate full store access, and it is distinct from the accessLevel-gated hypermedia surface.
 * Responses use a `{ result }` envelope, so a response with an undefined result serializes to JSON.
 */
import { DensityQuerySchema, GraphQuerySchema } from "./steps/domains/quad-types.js";
import { z } from "zod";
import { AccessLevelSchema } from "./resources.js";
import type { IQuadStore } from "./steps/ports.js";
import type { TRpcMethod } from "./rpc-wire.js";

export const STORE_METHOD_PREFIX = "store.";

export const STORE_READ = "store.read";
export const STORE_WRITE = "store.write";

const QuadInputSchema = z.object({
	subject: z.string(),
	predicate: z.string(),
	object: z.unknown(),
	namedGraph: z.string(),
	objectType: z.string().optional(),
	properties: z.record(z.string(), z.unknown()).optional(),
});

const PatternSchema = z.object({ subject: z.string().optional(), predicate: z.string().optional(), object: z.unknown().optional(), namedGraph: z.string().optional() });

/** Each method's param schema and read/write classification. This map is the one wire contract. */
const STORE_METHODS = {
	set: { write: true, params: QuadInputSchema },
	add: { write: true, params: z.object({ quad: QuadInputSchema }) },
	remove: { write: true, params: z.object({ pattern: PatternSchema }) },
	clear: { write: true, params: z.object({ namedGraph: z.string().optional() }) },
	upsertIndividual: { write: true, params: z.object({ label: z.string(), data: z.unknown() }) },
	deleteIndividual: { write: true, params: z.object({ label: z.string(), id: z.string() }) },
	createEdge: { write: true, params: z.object({ fromLabel: z.string(), fromId: z.string(), edgeLabel: z.string(), toLabel: z.string(), toId: z.string() }) },
	get: { write: false, params: z.object({ subject: z.string(), predicate: z.string(), namedGraph: z.string().optional() }) },
	query: { write: false, params: z.object({ pattern: PatternSchema }) },
	all: { write: false, params: z.object({}) },
	readRecords: { write: false, params: z.object({ query: GraphQuerySchema }) },
	distinctPropertyValues: { write: false, params: z.object({ label: z.string(), property: z.string() }) },
	density: { write: false, params: z.object({ query: DensityQuerySchema }) },
	getClusteredQuads: {
		write: false,
		params: z.object({ perTypeLimit: z.number(), types: z.array(z.string()).optional(), accessLevel: AccessLevelSchema, scope: z.enum(["own", "federated"]).optional() }),
	},
} as const;

type TStoreMethod = keyof typeof STORE_METHODS;

export function isStoreMethod(method: string): boolean {
	return method.startsWith(STORE_METHOD_PREFIX) && method.slice(STORE_METHOD_PREFIX.length) in STORE_METHODS;
}

/** The store surface as an `/rpc` method family. Each method requires the action that `requiredStoreCapability` names.
 *  Each call runs against the store that `getStore` returns when the call arrives. */
export function storeMethods(getStore: () => IQuadStore): Record<string, TRpcMethod> {
	return Object.fromEntries(
		Object.keys(STORE_METHODS).map((name) => {
			const method = `${STORE_METHOD_PREFIX}${name}`;
			return [name, { action: requiredStoreCapability(method), handle: (params: Record<string, unknown>) => handleStoreCall(getStore(), method, params) }];
		}),
	);
}

/** The capability a caller must hold for a store call. A call that changes the store requires store.write, and any other
 *  call requires store.read. */
export function requiredStoreCapability(method: string): string {
	const name = method.slice(STORE_METHOD_PREFIX.length) as TStoreMethod;
	const def = STORE_METHODS[name];
	if (!def) throw new Error(`${method} isn't a store method; the store methods are ${Object.keys(STORE_METHODS).join(", ")}`);
	return def.write ? STORE_WRITE : STORE_READ;
}

/**
 * Execute one store call against `store`. Params are validated against the wire contract, and an invalid shape throws.
 * `createEdge` implements the IQuadStore contract for the caller. It calls the documented `add` fallback for a store
 * without `createEdge`, so a remote caller receives the same behaviour from every store.
 */
export async function handleStoreCall(store: IQuadStore, method: string, rawParams: unknown): Promise<{ result: unknown }> {
	const name = method.slice(STORE_METHOD_PREFIX.length) as TStoreMethod;
	if (!STORE_METHODS[name]) throw new Error(`${method} isn't a store method; the store methods are ${Object.keys(STORE_METHODS).join(", ")}`);
	const raw = rawParams ?? {};
	switch (name) {
		case "set": {
			const { subject, predicate, object, namedGraph, properties } = STORE_METHODS.set.params.parse(raw);
			return { result: await store.set(subject, predicate, object, namedGraph, properties) };
		}
		case "add": {
			const { quad } = STORE_METHODS.add.params.parse(raw);
			return { result: await store.add(quad) };
		}
		case "remove": {
			const { pattern } = STORE_METHODS.remove.params.parse(raw);
			return { result: await store.remove(pattern) };
		}
		case "clear": {
			const { namedGraph } = STORE_METHODS.clear.params.parse(raw);
			return { result: await store.clear(namedGraph) };
		}
		case "upsertIndividual": {
			const { label, data } = STORE_METHODS.upsertIndividual.params.parse(raw);
			return { result: await store.upsertIndividual(label, data) };
		}
		case "deleteIndividual": {
			const { label, id } = STORE_METHODS.deleteIndividual.params.parse(raw);
			return { result: await store.deleteIndividual(label, id) };
		}
		case "createEdge": {
			const { fromLabel, fromId, edgeLabel, toLabel, toId } = STORE_METHODS.createEdge.params.parse(raw);
			if (store.createEdge) return { result: await store.createEdge(fromLabel, fromId, edgeLabel, toLabel, toId) };
			return { result: await store.add({ subject: fromId, predicate: edgeLabel, object: toId, namedGraph: fromLabel, objectType: toLabel }) };
		}
		case "get": {
			const { subject, predicate, namedGraph } = STORE_METHODS.get.params.parse(raw);
			return { result: await store.get(subject, predicate, namedGraph) };
		}
		case "query": {
			const { pattern } = STORE_METHODS.query.params.parse(raw);
			return { result: await store.query(pattern) };
		}
		case "all":
			return { result: await store.all() };
		case "readRecords": {
			const { query } = STORE_METHODS.readRecords.params.parse(raw);
			return { result: await store.readRecords(query) };
		}
		case "distinctPropertyValues": {
			const { label, property } = STORE_METHODS.distinctPropertyValues.params.parse(raw);
			return { result: await store.distinctPropertyValues(label, property) };
		}
		case "density": {
			const { query } = STORE_METHODS.density.params.parse(raw);
			return { result: await store.density(query) };
		}
		case "getClusteredQuads": {
			const { perTypeLimit, types, accessLevel, scope } = STORE_METHODS.getClusteredQuads.params.parse(raw);
			return { result: await store.getClusteredQuads({ perTypeLimit, types, accessLevel, scope }) };
		}
	}
}
