/**
 * The in-memory store of quads, which routes each named graph to a backing store where one is registered for it. A write
 * reaches the store that holds its named graph, and a read merges this store's own layer with every backing store's.
 *
 * It holds actuality in one process, a report's records and a test's records. Its own layer is indexed by graph, by
 * subject and by predicate, so a write, a read of a subject and a read of a predicate read only those quads. A read of
 * a type's records reads every quad of that type and then narrows, so a limit bounds the result rather than the work. A
 * store with a query engine behind it reads the same records from an index, and actuality too large to hold in memory
 * reads its records through such a store.
 */
import { z } from "zod";
import { unwrapToShape } from "../../domains/zod-unwrap.js";
import { RecordSchema, recordOf, schemaRecord } from "../../domains/json-text.js";
import { itemAt } from "../../domains/item-at.js";
import { JSON_LD_KEYWORD } from "../../domains/hypermedia.js";
import {
	SHARED_GRAPH,
	assertRegisteredSchema,
	matchesQuadPattern,
	typedRecord,
	type TCluster,
	type TClusteredQuads,
	type TClusteredQuadsOpts,
	type TDensityQuery,
	type TDensityResult,
	type TDistinctValues,
	type TGraphQuery,
	type TQuad,
	type TQuadPattern,
	type TRecordsPage,
	type TRecordType,
} from "../domains/quad-types.js";
import type { IQuadStore, TFederatedGraphSource, TStoreLevels } from "../ports.js";
import { AccessLevelSchema, HELD_BY, LinkRelations, withinAccess, type AccessLevel, type AccessQueryLevel } from "../../domains/resources.js";
import { seenAt, writesAtEveryLevel, writtenAt } from "../../domains/actions.js";
import { distinctOf, readFromRecords, recordsOfQuads, type THeldRecord, type TReadDeclaration, type TReadDeclarations } from "../../records/derivations/read-records.js";
import { quadsOfRead, readEvery, type TRecordReader } from "../../records/pipelines/record-reads.js";
import { densityOverQuadStore } from "../../records/pipelines/record-density.js";
import { QuadLayer } from "../../records/machines/quad-layer.js";
import { sliceQuadsPerType } from "../derivations/quad-sample.js";
import { curieOf, NotUnique, uniqueValuesOf, WRITE_VERB, type TNode, type TReadVersion, type TRecordName, type TRemoval, type TWriteVerb } from "../../records/domains/unit.js";
import { EDGE_TARGET } from "../../records/derivations/edge-declarations.js";
import {
	changedFields,
	nodeOf,
	partDeclarationOf,
	statesOnlyId,
	unitParts,
	wholeFields,
	UNDECLARED_ID_FIELD,
	type TPart,
	type TUnitEdge,
	type TUnitParts,
} from "../../records/derivations/unit-parts.js";
import { RecordVersions } from "../../records/pipelines/record-versions.js";
import { assertWritesWithin } from "../../records/pipelines/step-writes.js";
import type { TPartChanges } from "../../records/derivations/contract-writes.js";
import { withProvenance, type TProvenance } from "../../records/derivations/provenance.js";

/**
 * The backing stores and federated peers that a chain of stores shares by reference. Each store of a scenario and a
 * feature is built with its predecessor's chain, so a registration exists in one place and its removal removes it from
 * every store of the chain at once. A copy per store let a registration outlive its engine: a closed engine's store
 * stayed registered in an earlier copy and the next feature's reads read it.
 */
export type TStoreChain = {
	/** Each named graph's backing store. It holds the store's writes and pattern reads. */
	routing: Map<string, IQuadStore>;
	/** The federated peers, which only getClusteredQuads reads: a peer serves its sample within an access level, and doesn't
	 *  serve a write or a pattern read. */
	federated: Set<TFederatedGraphSource>;
};

/** A chain of stores without a backing store or a federated peer. The first store of actuality starts one. */
export const newStoreChain = (): TStoreChain => ({ routing: new Map(), federated: new Set() });

/** Throws where a fact a write sets on a record of a declared type isn't a field its schema parses or an edge its topology
 *  declares, so a fact set alone fits the type as a whole record's write does. */
function declaredField(schema: z.ZodType, { surface }: TReadDeclaration, { namedGraph, predicate, object }: Omit<TQuad, "timestamp">): void {
	// A JSON-LD keyword, such as the `@id` a page holds a served record by, isn't a field of the type.
	if (predicate in surface.references || predicate.startsWith(JSON_LD_KEYWORD)) return;
	const field = fieldSchemaOf(schema, predicate);
	if (field === undefined)
		throw new Error(`${namedGraph} doesn't declare the field ${predicate}, so a ${namedGraph} record doesn't hold it. Declare the field in the type's schema.`);
	schemaRecord(field, namedGraph, { [predicate]: object }, true);
}

/** Each type's schema of one field, by the type's schema and the field, built once: a write of a fact parses it through it. */
const fieldSchemas = new WeakMap<z.ZodType, Map<string, z.ZodType | undefined>>();

/** The schema that parses one field of a type's schema, or undefined where the type doesn't declare the field. */
function fieldSchemaOf(schema: z.ZodType, predicate: string): z.ZodType | undefined {
	let fields = fieldSchemas.get(schema);
	if (fields === undefined) {
		fields = new Map();
		fieldSchemas.set(schema, fields);
	}
	if (!fields.has(predicate)) {
		const field = unwrapToShape(schema)?.[predicate];
		fields.set(predicate, field === undefined ? undefined : z.object({ [predicate]: field }));
	}
	return fields.get(predicate);
}

/** Returns a record of a declared type as a store writes it: the fields its schema parsed, and the edges its topology declares,
 *  which the schema doesn't state. */
function declaredRecord(schema: z.ZodType, { surface }: TReadDeclaration, label: string, data: unknown): Record<string, unknown> {
	const edges = Object.entries(recordOf(data, `a ${label} record`)).filter(([field]) => field in surface.references);
	return { ...schemaRecord(schema, label, data, true), ...Object.fromEntries(edges) };
}

/** A change of this store's own layer: it removes the quads of a subject that `replaces` selects, and then holds `holds`. */
type TChange = { namedGraph: string; subject: string; replaces: (held: TQuad) => boolean; holds?: Omit<TQuad, "timestamp"> };

/** Returns the change that holds a quad, after it removes the quads of its subject that `replaces` selects. */
const holding = (quad: Omit<TQuad, "timestamp">, replaces: (held: TQuad) => boolean): TChange => ({ namedGraph: quad.namedGraph, subject: quad.subject, replaces, holds: quad });

/** Refuses a unit whose record holds an edge to a record the store doesn't hold, where the edge isn't declared a reference. */
function unheldTarget(record: TRecordName, edge: TUnitEdge): never {
	throw new Error(
		`${record.label} "${record.id}" holds an edge ${edge.rel} to ${curieOf(edge)}, which the store doesn't hold. Write the target first, or declare the edge a reference`,
	);
}

/** Doesn't select a quad, for a change that only adds one. */
const keepsEvery = (): boolean => false;

export class QuadStore implements IQuadStore {
	private readonly quads = new QuadLayer();
	private readonly versions = new RecordVersions();

	/**
	 * `chain` holds the backing stores and peers this store shares with its chain. `levels` classifies what this store writes
	 * and bounds what it reads for the call in progress; a store without levels holds a copy of what a site served, which
	 * was bounded where it was served, and doesn't classify a record. `declarations` returns the declarations of the types
	 * this store's own layer reads; a store without them doesn't read its layer by type. `derived` reads the records core
	 * derives from the declarations: each type whose declaration states `heldBy: declarations`.
	 */
	constructor(
		private readonly chain: TStoreChain,
		private readonly levels?: TStoreLevels,
		private readonly declarations?: () => TReadDeclarations,
		private readonly derived?: TRecordReader,
	) {}

	/** Returns the reader of derived records where core derives a type's records from the declarations and this store holds
	 *  that reader. A store without the reader holds the records it was given, as a page holds a copy of what a site served. */
	private derivedReaderOf(label: string): TRecordReader | undefined {
		return this.derived && this.declarations?.().of(label)?.heldBy === HELD_BY.declarations ? this.derived : undefined;
	}

	/** Throws for a write of a type whose records this store derives from the declarations. */
	private refuseDerived(label: string): void {
		if (this.derivedReaderOf(label))
			throw new Error(`${label} records are derived from the declarations, so a write of a ${label} record is rejected. Change the declaration of the type it describes.`);
	}

	/** Returns what reads a type's records: the reader of derived records, or the backing store registered for it. */
	private readerOf(label: string): TRecordReader | undefined {
		return this.derivedReaderOf(label) ?? this.storeFor(label);
	}

	/** The field that identifies a record of a type: the one its declaration states, or `id` for a type it doesn't declare. */
	private idFieldOf(label: string): string {
		const declared = this.declarations?.().of(label)?.id;
		return declared === undefined ? UNDECLARED_ID_FIELD : declared;
	}

	/** The named graphs of the quads this store's own layer holds. A backing store's graphs aren't read. */
	ownGraphs(): string[] {
		return this.quads.graphs();
	}

	/** The chain this store shares. The next store of the chain is built with it. */
	storeChain(): TStoreChain {
		return this.chain;
	}

	/** Merges a federated peer's clustered reads into this store's graph view. `unfederate` reverses it. */
	federate(source: TFederatedGraphSource): void {
		for (const f of this.chain.federated) {
			if (f.site === source.site) throw new Error(`a source for site ${source.site} is already federated; unfederate it before federating another`);
		}
		this.chain.federated.add(source);
	}

	unfederate(source: TFederatedGraphSource): void {
		this.chain.federated.delete(source);
	}

	/**
	 * Removes every connection to another instance: each federated peer and each remote backing store. A connection lasts
	 * as long as its peer, so a peer torn down as a feature ends doesn't leave a registration that the next feature's reads
	 * read at a closed port. A local backing store, such as an engine this instance owns, stays registered.
	 */
	dropRemoteConnections(): void {
		this.chain.federated.clear();
		for (const [ng, store] of [...this.chain.routing]) if (store.isRemote) this.chain.routing.delete(ng);
	}

	/** Registers a backing store for named graphs. A write of those graphs reaches it, and a read merges it. The quads this
	 *  store's own layer holds of those graphs move into the backing store as whole records, so a later write reads them there. */
	async registerStore(store: IQuadStore, namedGraphs: string[]): Promise<void> {
		const bySubject = new Map<string, { ng: string; record: Record<string, unknown> }>();
		for (const ng of namedGraphs)
			for (const q of this.quads.ofGraph(ng)) {
				const key = `${ng}\u0000${q.subject}`;
				const entry = bySubject.get(key);
				if (entry === undefined) bySubject.set(key, { ng, record: { [this.idFieldOf(ng)]: q.subject, [q.predicate]: q.object } });
				else entry.record[q.predicate] = q.object;
			}
		for (const ng of namedGraphs) this.chain.routing.set(ng, store);
		// A store that refuses a record this one holds isn't registered: this one keeps every record it holds, so the
		// next write of one of them reads it here, and the caller receives the store's refusal.
		try {
			for (const { ng, record } of bySubject.values()) await store.merge(nodeOf(ng, record));
		} catch (err) {
			this.unregisterStore(store);
			throw err;
		}
		for (const ng of namedGraphs) this.quads.removeWhere(this.quads.ofGraph(ng), () => true);
	}

	/**
	 * Removes every graph routed to `store`, the inverse of registerStore. The owner calls this when it closes its engine,
	 * and because the chain shares its routing, the registration leaves every store of the chain at once.
	 */
	unregisterStore(store: IQuadStore): void {
		for (const [ng, s] of [...this.chain.routing]) {
			if (s === store) this.chain.routing.delete(ng);
		}
	}

	/**
	 * Copies every quad of this store's own layer into the target store, except the variables. FeatureVariables writes the
	 * variables of the next scope from the ones it carries, with the steps that set each. The facts are held only in this
	 * layer, so the next scenario's store holds them through this copy. The chain is shared through the constructor, so a
	 * backing registration isn't copied.
	 */
	carryNonVariableQuadsTo(target: QuadStore): void {
		for (const q of this.quads) {
			if (q.namedGraph === SHARED_GRAPH) continue;
			target.quads.add({ ...q });
		}
	}

	private storeFor(namedGraph: string): IQuadStore | undefined {
		return this.chain.routing.get(namedGraph);
	}

	private get allStores(): IQuadStore[] {
		return [...new Set(this.chain.routing.values())];
	}

	/** Holds a batch of quads a site served: each quad replaces any prior quad with the same subject, predicate and named graph,
	 *  so caching a batch keeps one row per fact rather than appending. A quad of a declared type is a field its schema parses
	 *  or an edge its topology declares. The client's store does the same in one transaction. */
	// biome-ignore lint/suspicious/useAwait: a write, so a refused level rejects rather than throws, as every write here does
	async setMany(quads: TQuad[]): Promise<void> {
		const changes = quads.map(({ timestamp: _, ...quad }) => {
			this.refuseDerived(quad.namedGraph);
			const declaration = this.declarations?.().of(quad.namedGraph);
			if (declaration?.schema !== undefined) declaredField(declaration.schema, declaration, quad);
			return holding(this.classified(quad), (q) => q.predicate === quad.predicate);
		});
		this.apply(changes);
		for (const { namedGraph, subject } of changes) this.versions.changed({ label: namedGraph, id: subject });
	}

	create(node: TNode): Promise<string> {
		return this.writeUnit(WRITE_VERB.create, node, undefined, (store) => store.create(node));
	}

	update(node: TNode, version: TReadVersion): Promise<string> {
		return this.writeUnit(WRITE_VERB.update, node, version, (store) => store.update(node, version));
	}

	merge(node: TNode): Promise<string> {
		return this.writeUnit(WRITE_VERB.merge, node, undefined, (store) => store.merge(node));
	}

	/** What a write reads of a type's declaration: its id field, its schema's fields and its edges, or the id field alone for a type
	 *  the store's declarations don't name. */
	private readonly partDeclaration = (label: string) => {
		const declaration = this.declarations?.().of(label);
		return declaration === undefined ? undefined : partDeclarationOf(declaration);
	};

	/** Returns the one backing store of every part of a unit, or undefined where this store's own layer holds them. Refuses a unit
	 *  whose parts more than one store holds, since a write reaches one store and a unit is written whole. */
	private backingOf({ record, parts }: TUnitParts): IQuadStore | undefined {
		const stores = new Set(parts.map(({ label }) => this.storeFor(label)));
		if (stores.size === 1) return this.storeFor(record.label);
		const held = parts.map(({ label }) => `${label} (${this.storeFor(label) === undefined ? "this store" : "a backing store"})`);
		throw new Error(`${record.label} "${record.id}" owns records that different stores hold: ${held.join(", ")}. Register one store for every type of the unit`);
	}

	/**
	 * Writes the unit a verb writes from a node: through the one backing store of its parts, or into this store's own layer. Each
	 * change of the unit is computed and checked first, against the verb's version, the step's contract and the types' unique
	 * sets, and then applied without an await, so a reader, a carry at a scenario's end or a backing registration during the write
	 * never reads a unit that is half written.
	 */
	private async writeUnit(verb: TWriteVerb, node: TNode, version: TReadVersion | undefined, through: (store: IQuadStore) => Promise<string>): Promise<string> {
		const unit = unitParts(verb, node, version, this.partDeclaration);
		for (const part of unit.parts) this.refuseDerived(part.label);
		const backing = this.backingOf(unit);
		if (backing) return await through(backing);
		// A target a backing store holds is read there, so a unit whose targets this layer holds is applied without an await.
		for (const edge of this.unheldTargets(unit)) if ((await this.storeFor(edge.label)?.versionOf(edge)) === null) unheldTarget(unit.record, edge);
		this.versions.check([{ name: unit.record, version: unit.version, held: this.holds(unit.record) }]);
		const parts = unit.parts.map((part) => ({ part, held: this.holds(part) }));
		if (this.levels)
			assertWritesWithin(
				parts.map(({ part }) => this.partChanges(part)),
				this.levels.stepWrites(),
			);
		const provenance: TProvenance | undefined = this.levels && { generatedAtTime: this.levels.recordTime(), step: this.levels.currentStep() };
		const changes = parts.map(({ part, held }) => {
			const stated = provenance === undefined ? part : withProvenance(part, held, this.timeFieldOf(part.label), provenance);
			return { name: { label: part.label, id: part.id }, changes: this.changesOf(stated, held) };
		});
		for (const { name, changes: of } of changes) this.assertUnique(name, of);
		this.apply(changes.flatMap(({ changes: of }) => of));
		for (const { name } of changes) this.versions.changed(name);
		return unit.record.id;
	}

	/** Refuses a unit with an edge to a record that the unit doesn't write and this store's own layer doesn't hold, where the edge
	 *  isn't declared a reference and a backing store doesn't hold the record's type. Returns the edges whose records a backing
	 *  store may hold. */
	private unheldTargets({ record, parts }: TUnitParts): TUnitEdge[] {
		const unheld = parts
			.flatMap(({ edges }) => edges)
			.filter((edge) => edge.target !== EDGE_TARGET.reference && !parts.some(({ label, id }) => label === edge.label && id === edge.id) && !this.holds(edge));
		for (const edge of unheld) if (this.storeFor(edge.label) === undefined) unheldTarget(record, edge);
		return unheld;
	}

	/** Returns the field that places a type's records in time where its schema holds it, or undefined for a type that doesn't
	 *  declare its schema's time field. */
	private timeFieldOf(label: string): string | undefined {
		const declaration = this.partDeclaration(label);
		const field = this.declarations?.().of(label)?.defaultSort;
		return field === undefined || declaration?.fields?.has(field) === false ? undefined : field;
	}

	/** Returns the fields and relations a part changes in this store's own layer: each field whose value differs from the held
	 *  value, and each relation of an edge the layer doesn't hold. */
	private partChanges(part: TPart): TPartChanges {
		const held = [...this.quads.ofSubject(part.label, part.id)];
		const fields = Object.fromEntries(held.filter((q) => !q.objectType).map((q) => [q.predicate, q.object]));
		const edges = part.edges.filter(({ rel, id }) => !held.some((q) => q.objectType !== undefined && q.predicate === rel && q.object === id)).map(({ rel }) => rel);
		return { label: part.label, changed: [...changedFields(part, held.length === 0 ? undefined : fields, this.idFieldOf(part.label)), ...edges] };
	}

	/** Returns the version of a record's fields: in the backing store of its type, or in this store's own layer. */
	async versionOf(name: TRecordName): Promise<TReadVersion> {
		this.refuseDerived(name.label);
		const backing = this.storeFor(name.label);
		if (backing) return await backing.versionOf(name);
		return this.versions.of(name, this.holds(name));
	}

	/** Refuses the changes where they give the record `name` names the values of a set of properties its type declares unique,
	 *  which another record of the type in this store's own layer holds. */
	private assertUnique(name: TRecordName, changes: readonly TChange[]): void {
		const sets = this.declarations?.().of(name.label)?.unique;
		for (const fields of sets === undefined ? [] : sets) {
			const values = uniqueValuesOf(fields, (field) => this.valueAfter(name, changes, field));
			if (values === undefined) continue;
			const [first] = fields;
			const holds = (subject: string) => subject !== name.id && fields.every((field) => this.propertyQuad({ label: name.label, id: subject }, field)?.object === values[field]);
			const held = this.quads.candidates({ namedGraph: name.label, predicate: first });
			if ([...held].some((q) => q.namedGraph === name.label && q.predicate === first && holds(q.subject))) throw new NotUnique(name, values);
		}
	}

	/** Returns the value of a property of the record `name` names once `changes` are applied, or undefined where it doesn't hold one. */
	private valueAfter(name: TRecordName, changes: readonly TChange[], field: string): unknown {
		const own = changes.filter(({ namedGraph, subject }) => namedGraph === name.label && subject === name.id);
		const written = own.flatMap(({ holds }) => (holds?.predicate === field && !holds.objectType ? [holds] : [])).at(-1);
		if (written !== undefined) return written.object;
		const held = this.propertyQuad(name, field);
		return held === undefined || own.some(({ replaces }) => replaces(held)) ? undefined : held.object;
	}

	/** Returns the quad of a property of the record `name` names in this store's own layer, or undefined where it doesn't hold one. */
	private propertyQuad({ label, id }: TRecordName, field: string): TQuad | undefined {
		return [...this.quads.ofSubject(label, id)].find((q) => q.predicate === field && !q.objectType);
	}

	/** Returns whether this store's own layer holds the record `name` names: a field of it. A subject of which the layer holds
	 *  only edges is a reference, which a write of the record replaces, as a store that keeps edges strictly holds one. */
	private holds({ label, id }: TRecordName): boolean {
		return [...this.quads.ofSubject(label, id)].some(({ objectType }) => objectType === undefined);
	}

	/** Applies changes in order, without an await between them. */
	private apply(changes: readonly TChange[]): void {
		const timestamp = Date.now();
		for (const { namedGraph, subject, replaces, holds } of changes) {
			this.quads.removeWhere(this.quads.ofSubject(namedGraph, subject), replaces);
			if (holds !== undefined) this.quads.add({ ...holds, timestamp });
		}
	}

	/** Returns the changes one part's record and edges make in this store's own layer: the record whole where the layer doesn't
	 *  hold it, or else each field it states. Throws for a record its type refuses. */
	private changesOf(part: TPart, held: boolean): TChange[] {
		const { label, id } = part;
		const records = held ? this.fieldChanges(label, id, part.fields) : statesOnlyId(part) ? [] : this.recordChanges(part);
		// An edge of a record the unit writes is held at the record's level, which the store doesn't hold before the unit is applied.
		const written = records.find(({ holds }) => holds?.accessLevel !== undefined)?.holds?.accessLevel;
		const level = written === undefined ? {} : { accessLevel: written };
		const edges = part.edges.map(({ rel, label: toLabel, id: toId, target }): TChange => {
			// objectType states the target's type, so the quad reads back as an edge rather than a literal property.
			const quad = this.classified({ subject: id, predicate: rel, object: toId, namedGraph: label, objectType: toLabel, ...level });
			return holding(quad, target === EDGE_TARGET.only ? (q) => q.predicate === rel : (q) => q.predicate === rel && q.object === toId);
		});
		return [...records, ...edges];
	}

	/**
	 * Returns the changes of a record this store's own layer doesn't hold. A record states its level, as every persisted type's
	 * record does, and each of its quads is held at that level. A type that declares its schema writes the fields its schema
	 * parsed and the edges its topology declares; a type a store holds without a declaration, such as a test's own, is a record
	 * of fields. A null states a field the record doesn't hold.
	 */
	private recordChanges(part: TPart): TChange[] {
		const { label, id } = part;
		const fields = wholeFields(part, this.idFieldOf(label));
		const declared = this.levels?.declared(label);
		const parsedLevel = fields.accessLevel === undefined || fields.accessLevel === null ? undefined : AccessLevelSchema.parse(fields.accessLevel);
		const accessLevel = this.levels ? writtenAt(parsedLevel, declared, this.levels.writeBound()) : parsedLevel;
		const stated = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null));
		const leveled = declared ? { ...stated, accessLevel } : stated;
		const declaration = this.declarations?.().of(label);
		const validated = declaration?.schema === undefined ? RecordSchema.parse(leveled) : declaredRecord(declaration.schema, declaration, label, leveled);
		const level = accessLevel ? { accessLevel } : {};
		return Object.entries(validated)
			.filter(([, value]) => value !== undefined && value !== null)
			.map(([predicate, object]) => holding({ subject: id, predicate, object, namedGraph: label, ...level }, keepsEvery));
	}

	/** Returns the changes of fields of a record: a value replaces the field, and a null removes it. Each field is held at the
	 *  level the fields state, else at the record's. A field of a declared type is one its schema parses or an edge its topology
	 *  declares, so a field written alone fits the type as a whole record does. */
	private fieldChanges(label: string, id: string, fields: Readonly<Record<string, unknown>>): TChange[] {
		const declaration = this.declarations?.().of(label);
		const level = fields.accessLevel === undefined || fields.accessLevel === null ? {} : { accessLevel: AccessLevelSchema.parse(fields.accessLevel) };
		// The level a type's schema doesn't declare as a field is the level of the quads alone, as a whole record's is.
		const levelField = declaration?.schema === undefined || fieldSchemaOf(declaration.schema, LinkRelations.ACCESS_LEVEL.rel) !== undefined;
		return Object.entries(fields).flatMap(([predicate, object]): TChange[] => {
			if (object === undefined || (predicate === LinkRelations.ACCESS_LEVEL.rel && !levelField)) return [];
			const replaces = (q: TQuad): boolean => q.predicate === predicate;
			if (object === null) return [{ namedGraph: label, subject: id, replaces }];
			const quad = { subject: id, predicate, object, namedGraph: label, ...level };
			if (declaration?.schema !== undefined) declaredField(declaration.schema, declaration, quad);
			return [holding(this.classified(quad), replaces)];
		});
	}

	/**
	 * A quad as this store holds it: at the level `writtenAt` determines, as every store writes. A quad about a subject
	 * this store already holds is written into that subject, and states its level; a quad about a new one takes the level
	 * its type declares, where the writer may write there.
	 */
	private classified(quad: Omit<TQuad, "timestamp">): Omit<TQuad, "timestamp"> {
		if (!this.levels) return quad;
		const [first] = this.quads.ofSubject(quad.namedGraph, quad.subject);
		const accessLevel = writtenAt(quad.accessLevel === undefined ? first?.accessLevel : quad.accessLevel, this.levels.declared(quad.namedGraph), this.levels.writeBound());
		return { ...quad, accessLevel };
	}

	/** Whether a read at `asked` returns a quad this store holds, by the rule of every store. A read that doesn't state a
	 *  level reads at the caller's ceiling, and the instance's own read returns every level. */
	private seen(asked: AccessLevel | undefined): (q: TQuad) => boolean {
		if (!this.levels) return () => true;
		const { ceiling } = this.levels.bound();
		const level = asked === undefined ? ceiling : seenAt(asked, ceiling);
		if (level === undefined) return () => true;
		return (q) => withinAccess(q.accessLevel, level);
	}

	/** Refuses the removal of a quad the caller may not write at: removing a fact is written into its subject, as adding one is. */
	private removable(quads: TQuad[]): TQuad[] {
		const bound = this.levels?.writeBound();
		if (bound && !writesAtEveryLevel(bound)) for (const q of quads) if (q.accessLevel) writtenAt(q.accessLevel, undefined, bound);
		return quads;
	}

	get(subject: string, predicate: string, namedGraph?: string): Promise<unknown | undefined> {
		if (namedGraph) {
			const backing = this.storeFor(namedGraph);
			if (backing) return backing.get(subject, predicate, namedGraph);
		}
		// This store's own layer is read first, through the index of the subject or of the predicate, the most recent quad first.
		const seen = this.seen(undefined);
		const candidates = [...this.quads.candidates({ subject, predicate, ...(namedGraph === undefined ? {} : { namedGraph }) })];
		for (let i = candidates.length - 1; i >= 0; i--) {
			const q = itemAt(candidates, i);
			if (q.subject === subject && q.predicate === predicate && seen(q)) return Promise.resolve(q.object);
		}
		// A read that doesn't name a graph then reads each backing store.
		return namedGraph === undefined ? this.getFromBackingStores(subject, predicate) : Promise.resolve(undefined);
	}

	private async getFromBackingStores(subject: string, predicate: string): Promise<unknown | undefined> {
		for (const store of this.allStores) {
			const result = await store.get(subject, predicate);
			if (result !== undefined) return result;
		}
		return undefined;
	}

	async query(pattern: TQuadPattern): Promise<TQuad[]> {
		if (pattern.namedGraph) {
			const backing = this.storeFor(pattern.namedGraph);
			if (backing) return backing.query(pattern);
			return this.localQuery(pattern);
		}
		// A query that doesn't name a graph merges this store's own layer and every backing store.
		const local = this.localQuery(pattern);
		const backingResults = await Promise.all(this.allStores.map((s) => s.query(pattern)));
		return [...local, ...backingResults.flat()].sort((a, b) => a.timestamp - b.timestamp);
	}

	private localQuery(pattern: TQuadPattern): TQuad[] {
		const seen = this.seen(undefined);
		return [...this.quads.candidates(pattern)].filter((q) => matchesQuadPattern(q, pattern) && seen(q));
	}

	// biome-ignore lint/suspicious/useAwait: a write, so a refused level rejects rather than throws, as setQuad states
	async clear(namedGraph?: string): Promise<void> {
		if (namedGraph) {
			// A backing store holds what persists, so a clear removes only what this store's own layer holds.
			if (this.chain.routing.has(namedGraph)) return;
			for (const q of this.removable([...this.quads.ofGraph(namedGraph)])) this.quads.delete(q);
		} else {
			this.removable([...this.quads]);
			this.quads.clear();
		}
	}

	/** Removes what `removal` names from the backing store of its type, or from this store's own layer: a record with each record
	 *  it owns, transitively, or one of its edges. */
	async remove(removal: TRemoval): Promise<void> {
		const { label, id, edge } = removal;
		this.refuseDerived(label);
		const backing = this.storeFor(label);
		if (backing) return await backing.remove(removal);
		const held = [...this.quads.ofSubject(label, id)];
		if (edge !== undefined) {
			const { to } = edge;
			for (const q of this.removable(held.filter((q) => q.predicate === edge.rel && q.objectType === to.label && q.object === to.id))) this.quads.delete(q);
			return;
		}
		const owns = this.declarations?.().of(label)?.edges;
		const owned = held.filter((q) => q.objectType !== undefined && owns?.[q.predicate]?.owns === true);
		for (const q of this.removable(held)) this.quads.delete(q);
		this.versions.removed(removal);
		for (const q of owned) await this.remove({ label: String(q.objectType), id: String(q.object) });
	}

	async all(): Promise<TQuad[]> {
		const local = [...this.quads].filter(this.seen(undefined));
		const backingResults = await Promise.all(this.allStores.map((s) => s.all()));
		return [...local, ...backingResults.flat()].sort((a, b) => a.timestamp - b.timestamp);
	}

	/**
	 * Reads a page from the store that holds the read's records: the store of its label, of the record a reference read
	 * names, the reader of the records core derives from the declarations, or the one store that holds every type a term
	 * reads. Throws for a term whose types more than one store holds. This store's own layer reads through
	 * `readFromRecords`, which doesn't search text. A read of the records one of its records references reads each
	 * record that another store holds from that store.
	 */
	async readRecords(query: TGraphQuery): Promise<TRecordsPage> {
		const routed = this.routeOf(query);
		if (routed) return await routed.readRecords(query);
		return this.ownRecords(query, true);
	}

	/** Reads a page of this store's own layer. A held record crosses into code only where its type's schema parses it: here, where
	 *  `parsed` holds, and in a typed read, which parses the record it returns, so a record is parsed once. */
	private async ownRecords(query: TGraphQuery, parsed: boolean): Promise<TRecordsPage> {
		const declarations = this.declarations;
		if (!declarations) throw new Error("this store doesn't hold the declarations of its types, so it doesn't read records by type; build it with the declarations it reads");
		const held = recordsOfQuads(await quadsOfRead(query, (pattern) => Promise.resolve(this.localQuery(pattern))));
		const elsewhere = query.referencedBy ? await this.referencedElsewhere(held, query) : [];
		const declared = declarations();
		if (parsed)
			for (const { label, fields } of held) {
				const schema = declared.of(label)?.schema;
				if (schema !== undefined) schemaRecord(schema, label, fields, false);
			}
		return readFromRecords([...held, ...elsewhere], query, declared);
	}

	async readRecord<S extends z.ZodType>(type: TRecordType<S>, id: string, accessLevel?: AccessQueryLevel): Promise<z.output<S> | undefined> {
		const backing = this.storeFor(type.label);
		if (backing) return await backing.readRecord(type, id, accessLevel);
		assertRegisteredSchema(this.declarations?.(), type);
		const derived = this.derivedReaderOf(type.label);
		return typedRecord(type, id, accessLevel, (query) => (derived ? derived.readRecords(query) : this.ownRecords(query, false)));
	}

	/**
	 * Reads the records that a record of this store's own layer references and another store holds, from that store, at the
	 * read's level. Throws where that store returns a record without its id field.
	 */
	private async referencedElsewhere(held: readonly THeldRecord[], query: TGraphQuery): Promise<THeldRecord[]> {
		const { referencedBy, accessLevel } = query;
		if (!referencedBy) return [];
		const source = held.find((record) => record.label === referencedBy.label && record.id === referencedBy.id);
		const named = new Map<string, Set<string>>();
		const edges = source === undefined ? [] : source.edges;
		for (const edge of edges) {
			if (referencedBy.via && !referencedBy.via.includes(edge.rel)) continue;
			if (this.readerOf(edge.label) === undefined) continue;
			const ids = named.get(edge.label);
			if (ids === undefined) named.set(edge.label, new Set([edge.id]));
			else ids.add(edge.id);
		}
		const read = await Promise.all(
			[...named].map(async ([label, ids]) => {
				const reader = this.readerOf(label);
				if (!reader) throw new Error(`the store that holds ${label} records was removed during the read; read again once a store holds them`);
				const idField = this.declarations?.().of(label)?.id;
				if (!idField) throw new Error(`${label} isn't a declared type, so a record it names can't be read by its id; declare the type`);
				const vertices = await readEvery(reader, { label, named: [...ids], ...(accessLevel ? { accessLevel } : {}) });
				return vertices.map(({ "@id": _iri, "@type": _type, ...fields }): THeldRecord => {
					const id = fields[idField];
					if (typeof id !== "string" && typeof id !== "number") throw new Error(`a ${label} record read from another store doesn't state its id field ${idField}`);
					return { id: String(id), label, fields, edges: [], level: fields[LinkRelations.ACCESS_LEVEL.rel] };
				});
			}),
		);
		return read.flat();
	}

	/** Returns the store or reader that holds a read's records, or undefined where this store's own layer holds them. */
	private routeOf(query: TGraphQuery): TRecordReader | undefined {
		const label = query.label ?? query.references?.label ?? query.referencedBy?.label;
		if (label !== undefined) return this.readerOf(label);
		if (query.textQuery === undefined) return undefined;
		const stores = query.types ? [...new Set(query.types.map((type) => this.storeFor(type)))] : this.allStores;
		if (stores.length > 1)
			throw new Error(
				`a term reads the types of one store, and ${query.types ? `the types ${query.types.join(", ")}` : "the types this store routes"} are held by ${stores.length} stores: name the types of one store in types`,
			);
		return stores[0];
	}

	/**
	 * Reads a sample of each type. Every backing store samples its own records, through its engine's query. This store's
	 * own layer samples each requested type in memory, reading only that type's quads. A store doesn't read every quad to
	 * slice a sample.
	 */
	async getClusteredQuads(opts: TClusteredQuadsOpts): Promise<TClusteredQuads> {
		const allQuads: TQuad[] = [];
		const clustersByType = new Map<string, TCluster>();
		const mergeCluster = (c: TCluster) => {
			const existing = clustersByType.get(c.type);
			if (!existing) {
				clustersByType.set(c.type, { ...c, sampledSubjects: [...c.sampledSubjects], displayLabels: { ...c.displayLabels }, ...(c.sites ? { sites: { ...c.sites } } : {}) });
				return;
			}
			existing.sampledSubjects = [...new Set([...existing.sampledSubjects, ...c.sampledSubjects])];
			existing.sampledCount = existing.sampledSubjects.length;
			existing.totalCount = Math.max(existing.totalCount, c.totalCount, existing.sampledCount);
			existing.omittedCount = Math.max(0, existing.totalCount - existing.sampledCount);
			existing.displayLabels = { ...existing.displayLabels, ...c.displayLabels };
			if (c.saturated) existing.saturated = true;
			if (c.sites) existing.sites = { ...existing.sites, ...c.sites };
			if (c.omittedUnder) existing.omittedUnder = { ...existing.omittedUnder, ...c.omittedUnder };
		};

		// Federated peers and remote backing stores merge beside local backing stores; each states the site of its subjects
		// (TCluster.sites), so a merged cluster states which site served each subject. A read scoped "own" reads what this
		// instance is authoritative for, so it skips both: their records are the serving site's own.
		const own = opts.scope === "own";
		const backing = own ? this.allStores.filter((s) => !s.isRemote) : this.allStores;
		const peers = own ? [] : [...this.chain.federated];
		const backingResults = await Promise.all([...backing.map((s) => s.getClusteredQuads(opts)), ...peers.map((f) => f.getClusteredQuads(opts))]);
		for (const r of backingResults) {
			allQuads.push(...r.quads);
			for (const c of r.clusters) mergeCluster(c);
		}

		const seen = this.seen(opts.accessLevel);
		const held = opts.types === undefined ? [...this.quads] : opts.types.flatMap((type) => [...this.quads.ofGraph(type)]);
		const localClustered = sliceQuadsPerType(held.filter(seen), opts.perTypeLimit, allQuads, (type) => this.declarations?.().of(type));
		allQuads.push(...localClustered.quads);
		for (const c of localClustered.clusters) mergeCluster(c);

		allQuads.sort((a, b) => a.timestamp - b.timestamp);
		return { quads: allQuads, clusters: [...clustersByType.values()] };
	}

	density(query: TDensityQuery): Promise<TDensityResult> {
		return densityOverQuadStore(this, query);
	}

	async distinctPropertyValues(label: string, property: string): Promise<TDistinctValues> {
		const backing = this.storeFor(label);
		if (backing) return backing.distinctPropertyValues(label, property);
		const quads = await this.query({ predicate: property, namedGraph: label });
		return distinctOf(quads.map((q) => String(q.object)));
	}
}
