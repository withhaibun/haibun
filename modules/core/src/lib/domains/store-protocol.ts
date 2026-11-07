/**
 * store-protocol: the delegated store surface. The server (an `/rpc` method family) and the client
 * (RemoteQuadStore) share it. It serves the IQuadStore methods as `store.<method>` protocol calls, so a
 * sibling instance can keep its records in this instance's store. The surface is delegated and never
 * public. Each method requires the `store.read` or the `store.write` capability. The surface gives a
 * trusted delegate full store access, and it is distinct from the accessLevel-gated hypermedia surface.
 * Responses use a `{ result }` envelope, so a response with an undefined result serializes to JSON.
 */
import { ActionSchema, type TAction } from "./actions.js";
import { DensityQuerySchema, GraphQuerySchema } from "../steps/domains/quad-types.js";
import { z } from "zod";
import { AccessLevelSchema } from "./resources.js";
import type { IQuadStore } from "../steps/ports.js";
import type { TRpcMethod } from "../transport/ports.js";
import { EDGE_TARGET, type TRemoval, type TUnit } from "../records/domains/unit.js";

export const STORE_METHOD_PREFIX = "store.";

export const STORE_READ: TAction = ActionSchema.parse("store.read");
export const STORE_WRITE: TAction = ActionSchema.parse("store.write");

const PatternSchema = z.object({ subject: z.string().optional(), predicate: z.string().optional(), object: z.unknown().optional(), namedGraph: z.string().optional() });

const EdgeTargetSchema = z.enum([EDGE_TARGET.held, EDGE_TARGET.reference, EDGE_TARGET.only]);
const RecordNameSchema = z.object({ label: z.string(), id: z.string() });
const UnitEdgeSchema = z.object({ rel: z.string(), label: z.string(), id: z.string(), target: EdgeTargetSchema });
const UnitPartsSchema = z.object({ edges: z.array(UnitEdgeSchema).optional(), owns: z.array(z.lazy((): z.ZodType<TUnit> => UnitSchema)).optional() });

/** A unit as a transport carries it. */
const UnitSchema: z.ZodType<TUnit> = z.union([
	UnitPartsSchema.extend({ label: z.string(), record: z.record(z.string(), z.unknown()), merge: z.literal(true).optional(), namedBy: RecordNameSchema.optional() }),
	UnitPartsSchema.extend({ label: z.string(), id: z.string(), fields: z.record(z.string(), z.unknown()) }),
	UnitPartsSchema.extend({ label: z.string(), id: z.string(), referenced: z.literal(true) }),
]);

/** A removal as a transport carries it. */
const RemovalSchema: z.ZodType<TRemoval> = z.union([
	RecordNameSchema.extend({ field: z.string() }),
	RecordNameSchema.extend({ edge: z.object({ rel: z.string(), to: z.string() }) }),
	RecordNameSchema,
]);

/** Each method's param schema and read/write classification. This map is the one wire contract. */
const STORE_METHODS = {
	write: { write: true, params: z.object({ unit: UnitSchema }) },
	remove: { write: true, params: z.object({ removal: RemovalSchema }) },
	clear: { write: true, params: z.object({ namedGraph: z.string().optional() }) },
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
export function requiredStoreCapability(method: string): TAction {
	const name = method.slice(STORE_METHOD_PREFIX.length) as TStoreMethod;
	const def = STORE_METHODS[name];
	if (!def) throw new Error(`${method} isn't a store method; the store methods are ${Object.keys(STORE_METHODS).join(", ")}`);
	return def.write ? STORE_WRITE : STORE_READ;
}

/**
 * Execute one store call against `store`. Params are validated against the wire contract, and an invalid shape throws.
 */
export async function handleStoreCall(store: IQuadStore, method: string, rawParams: unknown): Promise<{ result: unknown }> {
	const name = method.slice(STORE_METHOD_PREFIX.length) as TStoreMethod;
	if (!STORE_METHODS[name]) throw new Error(`${method} isn't a store method; the store methods are ${Object.keys(STORE_METHODS).join(", ")}`);
	switch (name) {
		case "write": {
			const { unit } = STORE_METHODS.write.params.parse(rawParams);
			return { result: await store.write(unit) };
		}
		case "remove": {
			const { removal } = STORE_METHODS.remove.params.parse(rawParams);
			return { result: await store.remove(removal) };
		}
		case "clear": {
			const { namedGraph } = STORE_METHODS.clear.params.parse(rawParams);
			return { result: await store.clear(namedGraph) };
		}
		case "get": {
			const { subject, predicate, namedGraph } = STORE_METHODS.get.params.parse(rawParams);
			return { result: await store.get(subject, predicate, namedGraph) };
		}
		case "query": {
			const { pattern } = STORE_METHODS.query.params.parse(rawParams);
			return { result: await store.query(pattern) };
		}
		case "all":
			return { result: await store.all() };
		case "readRecords": {
			const { query } = STORE_METHODS.readRecords.params.parse(rawParams);
			return { result: await store.readRecords(query) };
		}
		case "distinctPropertyValues": {
			const { label, property } = STORE_METHODS.distinctPropertyValues.params.parse(rawParams);
			return { result: await store.distinctPropertyValues(label, property) };
		}
		case "density": {
			const { query } = STORE_METHODS.density.params.parse(rawParams);
			return { result: await store.density(query) };
		}
		case "getClusteredQuads": {
			const { perTypeLimit, types, accessLevel, scope } = STORE_METHODS.getClusteredQuads.params.parse(rawParams);
			return { result: await store.getClusteredQuads({ perTypeLimit, types, accessLevel, scope }) };
		}
	}
}
