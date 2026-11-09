/**
 * The graph of one actuality's records the device holds, as an `IQuadStore`: its quads, read as records. A view reads what
 * the page holds by the reads it sends the site, so a view offline reads the records the site already served this reader.
 */
import type { z } from "zod";
import { storeScopeFor, withinAccess, type AccessQueryLevel } from "@haibun/core/lib/domains/resources.js";
import type { TClusteredQuads, TDensityQuery, TDensityResult, TDistinctValues, TGraphQuery, TQuad, TQuadPattern, TRecordsPage, TRecordType } from "@haibun/core/lib/quad-types.js";
import { distinctOf, type TReadDeclarations } from "@haibun/core/lib/records/derivations/read-records.js";
import { assertRegisteredSchema, typedRecord } from "@haibun/core/lib/quad-types.js";
import { readQuadRecords } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { densityOverQuadStore } from "@haibun/core/lib/records/pipelines/record-density.js";
import { sliceQuadsPerType } from "@haibun/core/lib/steps/derivations/quad-sample.js";
import type { TDeviceGraph, TDeviceQuads, TGraphSaturation } from "../ports.js";
import { levelsOf, subjectKey } from "../derivations/quads.js";
import { NODE_KEY, WRITE_VERB, type TNode, type TReadVersion, type TRecordName, type TRemoval, type TWriteVerb } from "@haibun/core/lib/records/domains/unit.js";
import { EDGE_TARGET } from "@haibun/core/lib/records/derivations/edge-declarations.js";
import type { TPart } from "@haibun/core/lib/records/derivations/unit-parts.js";
import { RecordVersions } from "@haibun/core/lib/records/pipelines/record-versions.js";
import type { TDeviceChange } from "../ports.js";

/** Returns the change one part makes of the device's quads: each field in place of the quad of its predicate, a null removing it,
 *  and each edge in place of the record's edge to its target, or to any target where it is the record's one target. A page holds
 *  the `@id` a node states, as it holds the `@id` of a record a site served. */
function changeOf({ label, id, fields, edges, iri }: TPart): TDeviceChange {
	const stated = Object.entries(iri === undefined ? fields : { ...fields, [NODE_KEY.id]: iri });
	return {
		removes: [
			...stated.map(([predicate]) => ({ subject: id, namedGraph: label, predicate })),
			...edges.map(({ rel, id: to, target }) => ({ subject: id, namedGraph: label, predicate: rel, ...(target === EDGE_TARGET.only ? {} : { object: to }) })),
		],
		adds: [
			...stated.flatMap(([predicate, object]) => (object === null ? [] : [{ subject: id, predicate, object, namedGraph: label }])),
			...edges.map(({ rel, label: objectType, id: object }) => ({ subject: id, predicate: rel, object, namedGraph: label, objectType })),
		],
	};
}

export class DeviceGraph implements TDeviceGraph {
	readonly database: string;
	private readonly versions = new RecordVersions();
	/** The write the device holds in progress. Writes run in turn, so a write checks versions against every write before it. */
	private writing: Promise<unknown> = Promise.resolve();

	/** `quads` holds the facts, and `declarations` returns the declarations of the types whose records it reads. */
	constructor(
		private readonly quads: TDeviceQuads,
		private readonly declarations: () => TReadDeclarations,
	) {
		this.database = quads.database;
	}

	saturation(): Promise<TGraphSaturation> {
		return this.quads.saturation();
	}

	get(subject: string, predicate: string, namedGraph?: string): Promise<unknown | undefined> {
		return this.quads.get(subject, predicate, namedGraph);
	}

	query(pattern: TQuadPattern): Promise<TQuad[]> {
		return this.quads.query(pattern);
	}

	clear(namedGraph?: string): Promise<void> {
		return this.quads.clear(namedGraph);
	}

	/** Removes what `removal` names: a record's quads with each record it owns, transitively, or one of its edges. */
	remove(removal: TRemoval): Promise<void> {
		return this.inTurn(() => this.removeNow(removal));
	}

	/** Runs `change` after every write and removal before it. */
	private inTurn<T>(change: () => Promise<T>): Promise<T> {
		const made = this.writing.then(change);
		this.writing = made.catch(() => undefined);
		return made;
	}

	private async removeNow({ label, id, edge }: TRemoval): Promise<void> {
		if (edge !== undefined) return await this.quads.change({ removes: [{ subject: id, namedGraph: label, predicate: edge.rel, object: edge.to.id }], adds: [] });
		const owns = this.declarations().of(label)?.edges;
		const owned = (await this.quads.query({ subject: id, namedGraph: label })).filter((q) => q.objectType !== undefined && owns?.[q.predicate]?.owns === true);
		await this.quads.change({ removes: [{ subject: id, namedGraph: label }], adds: [] });
		this.versions.removed({ label, id });
		for (const q of owned) await this.removeNow({ label: String(q.objectType), id: String(q.object) });
	}

	/** Returns whether the device holds a quad of the record `name` names. */
	private async holds({ label, id }: TRecordName): Promise<boolean> {
		return (await this.quads.query({ subject: id, namedGraph: label })).length > 0;
	}

	async versionOf(name: TRecordName): Promise<TReadVersion> {
		return this.versions.of(name, await this.holds(name));
	}

	all(): Promise<TQuad[]> {
		return this.quads.all();
	}

	/** Holds the quads a site served, in turn with the device's writes, and gives each record they change its next version, so an
	 *  update of a version read before the site's change is refused. */
	setMany(quads: TQuad[]): Promise<void> {
		return this.inTurn(async () => {
			await this.quads.setMany(quads);
			for (const { namedGraph, subject } of quads) this.versions.changed({ label: namedGraph, id: subject });
		});
	}

	create(node: TNode): Promise<string> {
		return this.inTurn(() => this.writeNow(WRITE_VERB.create, node, undefined));
	}

	update(node: TNode, version: TReadVersion): Promise<string> {
		return this.inTurn(() => this.writeNow(WRITE_VERB.update, node, version));
	}

	merge(node: TNode): Promise<string> {
		return this.inTurn(() => this.writeNow(WRITE_VERB.merge, node, undefined));
	}

	/** Writes the unit a verb writes from a node in one transaction of the device's quads, each field in place of the quad of its
	 *  predicate and a null removing it, and each edge in place of the record's edge to its target, or to any target where it is
	 *  the record's one target of the relation. Returns the id of the unit's record. */
	private async writeNow(verb: TWriteVerb, node: TNode, version: TReadVersion | undefined): Promise<string> {
		// A page holds what a site served, which it writes through setMany, so it loads the derivation of a unit's parts where it
		// writes a node.
		const { partDeclarationOf, unitParts } = await import("@haibun/core/lib/records/derivations/unit-parts.js");
		const unit = unitParts(verb, node, version, (label) => {
			const declaration = this.declarations().of(label);
			return declaration === undefined ? undefined : partDeclarationOf(declaration);
		});
		this.versions.check([{ name: unit.record, version: unit.version, held: await this.holds(unit.record) }]);
		const changes = unit.parts.map(changeOf);
		await this.quads.change({ removes: changes.flatMap(({ removes }) => removes), adds: changes.flatMap(({ adds }) => adds) });
		for (const part of unit.parts) this.versions.changed(part);
		return unit.record.id;
	}

	/** Reads a page of the records the device holds, without a search of their text. */
	readRecords(query: TGraphQuery): Promise<TRecordsPage> {
		return readQuadRecords(query, (pattern) => this.quads.query(pattern), this.declarations());
	}

	/** Reads a record the device holds, parsed once by its type's schema, which the device's declaration of the type registers. */
	readRecord<S extends z.ZodType>(type: TRecordType<S>, id: string, accessLevel?: AccessQueryLevel): Promise<z.output<S> | undefined> {
		assertRegisteredSchema(this.declarations(), type);
		return typedRecord(type, id, accessLevel, (query) => this.readRecords(query));
	}

	density(query: TDensityQuery): Promise<TDensityResult> {
		return densityOverQuadStore(this, query);
	}

	async distinctPropertyValues(label: string, property: string): Promise<TDistinctValues> {
		const quads = await this.quads.query({ predicate: property, namedGraph: label });
		return distinctOf(quads.map((q) => String(q.object)));
	}

	/**
	 * The clustered quads the site returns for the same read. Named types read through the type index, so a read of a few
	 * types reads only theirs. A page holds what it was served, which may have been read at a wider level than this read
	 * names: a record stating a level beyond it is left out, so the level a reader sets means the same whether or not a
	 * site serves the page. Each subject's level is read from one map, built in one pass.
	 */
	async getClusteredQuads(opts: { perTypeLimit: number; types?: string[]; accessLevel: AccessQueryLevel }): Promise<TClusteredQuads> {
		const types = opts.types;
		const named = types === undefined ? await this.quads.all() : (await Promise.all(types.map((namedGraph) => this.quads.query({ namedGraph })))).flat();
		const levels = levelsOf(named);
		// A read of every level reads at the widest, as every surface scopes it.
		const seen = storeScopeFor(opts.accessLevel);
		const declarations = this.declarations();
		return sliceQuadsPerType(
			named.filter((q) => withinAccess(levels.get(subjectKey(q)), seen)),
			opts.perTypeLimit,
			[],
			(type) => declarations.of(type),
		);
	}
}
