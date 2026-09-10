/**
 * store-protocol: the delegated store surface, shared by server (web-server transport) and client
 * (RemoteQuadStore). Serves the IQuadStore methods as `store.<method>` protocol calls so a sibling
 * instance can keep its records in this instance's store. DELEGATED, never public: every call requires
 * a capability (`store.read` or `store.write` by method; a `store.*` grant covers both): this surface
 * is full store access for a trusted delegate, distinct from the accessLevel-gated hypermedia surface.
 * Responses use a `{ result }` envelope so an undefined result survives JSON intact.
 */
import { DensityQuerySchema } from "./quad-types.js";
import { z } from "zod";
import { AccessLevelSchema } from "./resources.js";
import type { IQuadStore } from "./quad-types.js";

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

/** Param schema + read/write classification per method: the single wire contract. */
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
	getIndividual: { write: false, params: z.object({ label: z.string(), id: z.string() }) },
	queryIndividuals: {
		write: false,
		params: z.object({
			label: z.string(),
			filters: z.record(z.string(), z.unknown()).optional(),
			options: z.object({ limit: z.number().optional(), offset: z.number().optional() }).optional(),
		}),
	},
	distinctPropertyValues: { write: false, params: z.object({ label: z.string(), property: z.string() }) },
	density: { write: false, params: z.object({ query: DensityQuerySchema }) },
	getClusteredQuads: {
		write: false,
		params: z.object({ perTypeLimit: z.number(), types: z.array(z.string()).optional(), accessLevel: AccessLevelSchema, scope: z.enum(["own", "federated"]).optional() }),
	},
} as const;

export type TStoreMethod = keyof typeof STORE_METHODS;

export function isStoreMethod(method: string): boolean {
	return method.startsWith(STORE_METHOD_PREFIX) && method.slice(STORE_METHOD_PREFIX.length) in STORE_METHODS;
}

/** The capability a caller must hold for a store call, store.write for anything that changes the store, store.read otherwise. */
export function requiredStoreCapability(method: string): string {
	const name = method.slice(STORE_METHOD_PREFIX.length) as TStoreMethod;
	const def = STORE_METHODS[name];
	if (!def) throw new Error(`requiredStoreCapability: unknown store method ${method}`);
	return def.write ? STORE_WRITE : STORE_READ;
}

/**
 * Execute one store call against `store`, validating params against the wire contract (fail fast on shape).
 * `createEdge` honours the IQuadStore contract on the caller's behalf: a store without the edge primitive
 * gets the documented `add` fallback here, so a remote caller sees one behaviour.
 */
export async function handleStoreCall(store: IQuadStore, method: string, rawParams: unknown): Promise<{ result: unknown }> {
	const name = method.slice(STORE_METHOD_PREFIX.length) as TStoreMethod;
	if (!STORE_METHODS[name]) throw new Error(`handleStoreCall: unknown store method ${method}`);
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
		case "getIndividual": {
			const { label, id } = STORE_METHODS.getIndividual.params.parse(raw);
			return { result: await store.getIndividual(label, id) };
		}
		case "queryIndividuals": {
			const { label, filters, options } = STORE_METHODS.queryIndividuals.params.parse(raw);
			return { result: await store.queryIndividuals(label, filters, options) };
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
