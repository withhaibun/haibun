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
import {
	ChangedSinceRead,
	NODE_KEY,
	WRITE_VERB,
	WriteOutsideContract,
	type TNode,
	type TRecordName,
	type TRemoval,
	type TUnitRemoved,
	type TUnitWrite,
	type TUnitWritten,
} from "../records/domains/unit.js";
import { inCall, runInCall } from "./capability-context.js";
import type { TStepWrites } from "../steps/domains/contract.js";

export const STORE_METHOD_PREFIX = "store.";

export const STORE_READ: TAction = ActionSchema.parse("store.read");
export const STORE_WRITE: TAction = ActionSchema.parse("store.write");

const PatternSchema = z.object({ subject: z.string().optional(), predicate: z.string().optional(), object: z.unknown().optional(), namedGraph: z.string().optional() });

const RecordNameSchema = z.object({ label: z.string(), id: z.string() });

/** A node as a transport carries it: the type of its record, and its fields and edges. */
const NodeSchema: z.ZodType<TNode> = z.object({ [NODE_KEY.type]: z.string() }).catchall(z.unknown());

/** The writes the contract of the caller's step in progress allows, which the serving store checks a write against. */
const StepWritesSchema = z.object({
	step: z.string(),
	products: z.array(z.string()),
	changes: z.array(z.union([z.object({ persistedAs: z.string(), key: z.string() }), z.object({ relation: z.string() })])),
});

/** What a write sends over a transport: the node, and the writes of the caller's step in progress where it is in one. */
const WriteParamsSchema = z.object({ node: NodeSchema, writes: StepWritesSchema.optional() });

/** Each record a store call wrote within the writes of the caller's step, as a transport returns them to the step's written records. */
const WrittenSchema = z.array(RecordNameSchema);

/** What a write returns over a transport: the id of the unit's record with each record the write wrote, the refusal of a unit whose
 *  record changed since its caller read it, or the refusal of a unit outside the contract of the caller's step, which the calling
 *  side throws as the store threw it. */
const StoreWriteResultSchema = z.union([
	z.object({ id: z.string(), written: WrittenSchema }),
	z.object({ changedSinceRead: z.object({ record: RecordNameSchema, read: z.string().nullable(), held: z.string().nullable() }) }),
	z.object({ outsideContract: z.object({ step: z.string(), outside: z.array(z.string()) }) }),
]);
type TStoreWriteResult = z.infer<typeof StoreWriteResultSchema>;

/** Returns the writes of a step as a transport carries them, without the refusals the calling side records. */
export const sentWrites = (writes: TStepWrites | undefined) =>
	writes === undefined ? {} : { writes: { step: writes.step, products: [...writes.products], changes: [...writes.changes] } };

/** A unit of a batch as a transport carries it. */
const UnitWriteSchema: z.ZodType<TUnitWrite> = z.discriminatedUnion("verb", [
	z.object({ verb: z.literal(WRITE_VERB.create), node: NodeSchema }),
	z.object({ verb: z.literal(WRITE_VERB.merge), node: NodeSchema }),
	z.object({ verb: z.literal(WRITE_VERB.update), node: NodeSchema, version: z.string().nullable() }),
]);

/** How each unit of a batch ended, with each record the batch wrote, as a transport carries them. */
const UnitsWrittenSchema = z.object({ units: z.array(z.union([z.object({ id: z.string() }), z.object({ refused: z.string() })])), written: WrittenSchema });

/** A removal as a transport carries it. */
const RemovalSchema: z.ZodType<TRemoval> = RecordNameSchema.extend({ edge: z.object({ rel: z.string(), to: RecordNameSchema }).optional() });

/** How each removal of a batch ended, as a transport carries it. */
export const UnitsRemovedSchema: z.ZodType<TUnitRemoved[]> = z.array(z.union([z.object({ removed: RecordNameSchema }), z.object({ refused: z.string() })]));

/** Each method's param schema and read/write classification. This map is the one wire contract. */
const STORE_METHODS = {
	create: { write: true, params: WriteParamsSchema },
	update: { write: true, params: WriteParamsSchema.extend({ version: z.string().nullable() }) },
	merge: { write: true, params: WriteParamsSchema },
	writeMany: { write: true, params: z.object({ units: z.array(UnitWriteSchema), writes: StepWritesSchema.optional() }) },
	remove: { write: true, params: z.object({ removal: RemovalSchema }) },
	removeMany: { write: true, params: z.object({ removals: z.array(RemovalSchema) }) },
	versionOf: { write: false, params: z.object({ name: RecordNameSchema }) },
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
		case WRITE_VERB.create:
		case WRITE_VERB.merge: {
			const { node, writes } = STORE_METHODS[name].params.parse(rawParams);
			return { result: await writtenOver(writes, () => (name === WRITE_VERB.create ? store.create(node) : store.merge(node))) };
		}
		case WRITE_VERB.update: {
			const { node, writes, version } = STORE_METHODS.update.params.parse(rawParams);
			return { result: await writtenOver(writes, () => store.update(node, version)) };
		}
		case "writeMany": {
			const { units, writes } = STORE_METHODS.writeMany.params.parse(rawParams);
			const { value, written } = await inCallerWrites(writes, () => store.writeMany(units));
			return { result: { units: value, written } };
		}
		case "remove": {
			const { removal } = STORE_METHODS.remove.params.parse(rawParams);
			return { result: await store.remove(removal) };
		}
		case "removeMany": {
			const { removals } = STORE_METHODS.removeMany.params.parse(rawParams);
			return { result: await store.removeMany(removals) };
		}
		case "versionOf": {
			const { name: record } = STORE_METHODS.versionOf.params.parse(rawParams);
			return { result: await store.versionOf(record) };
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

/** Runs a store call within the writes of the caller's step, and returns its value with each record it wrote, which the calling
 *  side adds to the step's written records. */
async function inCallerWrites<T>(writes: z.infer<typeof StepWritesSchema> | undefined, call: () => Promise<T>): Promise<{ value: T; written: TRecordName[] }> {
	const delegatedWrites = writes === undefined ? undefined : { ...writes, refused: [], written: [] };
	const value = await runInCall({ ...inCall(), delegatedWrites }, call);
	return { value, written: delegatedWrites === undefined ? [] : delegatedWrites.written };
}

/** Runs a write within the writes of the caller's step, and returns its result as a transport carries it: the record's id with each
 *  record the write wrote, or the refusal of a record that changed since its read or of a write outside the step's contract. */
async function writtenOver(writes: z.infer<typeof StepWritesSchema> | undefined, write: () => Promise<string>): Promise<TStoreWriteResult> {
	try {
		const { value, written } = await inCallerWrites(writes, write);
		return { id: value, written };
	} catch (error) {
		if (error instanceof ChangedSinceRead) return { changedSinceRead: { record: error.record, read: error.read, held: error.held } };
		if (error instanceof WriteOutsideContract) return { outsideContract: { step: error.step, outside: [...error.outside] } };
		throw error;
	}
}

/** Returns the id a write's result over a transport holds, and adds each record the serving store wrote to the written records of
 *  the caller's step. Throws the refusal it holds as the serving store threw it, adding a write outside the contract to the refused
 *  writes of the caller's step. */
export function writtenId(result: unknown, writes: TStepWrites | undefined): string {
	const written = StoreWriteResultSchema.parse(result);
	if ("id" in written) {
		writes?.written.push(...written.written);
		return written.id;
	}
	if ("changedSinceRead" in written) throw new ChangedSinceRead(written.changedSinceRead.record, written.changedSinceRead.read, written.changedSinceRead.held);
	writes?.refused.push(...written.outsideContract.outside);
	throw new WriteOutsideContract(written.outsideContract.step, written.outsideContract.outside);
}

/** Returns how each unit of a batch's result over a transport ended, and adds each record the serving store wrote to the written
 *  records of the caller's step. */
export function unitsWritten(result: unknown, writes: TStepWrites | undefined): TUnitWritten[] {
	const { units, written } = UnitsWrittenSchema.parse(result);
	writes?.written.push(...written);
	return units;
}
