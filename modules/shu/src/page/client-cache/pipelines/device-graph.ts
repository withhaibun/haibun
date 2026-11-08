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
import { densityOverQuadStore } from "@haibun/core/lib/quad-store.js";
import { sliceQuadsPerType } from "@haibun/core/lib/steps/derivations/quad-sample.js";
import type { TDeviceGraph, TDeviceQuads, TGraphSaturation } from "../ports.js";
import { individualAsQuads, levelsOf, subjectKey } from "../derivations/quads.js";
import { EDGE_TARGET, unitsOf, type TReadVersion, type TRecordName, type TRemoval, type TUnit } from "@haibun/core/lib/records/domains/unit.js";
import { RecordVersions } from "@haibun/core/lib/records/pipelines/record-versions.js";

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

	/** Removes what `removal` names: a record's quads, one of its fields, or one of its edges. */
	remove(removal: TRemoval): Promise<void> {
		return this.inTurn(() => this.removeNow(removal));
	}

	/** Runs `change` after every write and removal before it. */
	private inTurn<T>(change: () => Promise<T>): Promise<T> {
		const made = this.writing.then(change);
		this.writing = made.catch(() => undefined);
		return made;
	}

	private removeNow({ label, id, field, edge }: TRemoval): Promise<void> {
		if (edge === undefined) this.versions[field === undefined ? "removed" : "changed"]({ label, id });
		return this.quads.remove({ subject: id, namedGraph: label, predicate: field === undefined ? edge?.rel : field, object: edge?.to });
	}

	/** Returns the id of a unit's record. */
	private idOf(unit: TUnit): string {
		return individualAsQuads(unit.label, "record" in unit ? unit.record : { id: unit.id })[0];
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

	setMany(quads: TQuad[]): Promise<void> {
		return this.quads.setMany(quads);
	}

	/** Writes the units a unit owns, then its record, each field in place of the quad of its predicate and a null removing it,
	 *  then its edges. Returns the id of the unit's record. */
	write(unit: TUnit): Promise<string> {
		return this.inTurn(() => this.writeNow(unit));
	}

	private async writeNow(unit: TUnit): Promise<string> {
		const parts = await Promise.all(
			unitsOf(unit).map(async (part) => {
				const quads = individualAsQuads(part.label, "record" in part ? part.record : { id: part.id, ...("fields" in part ? part.fields : {}) });
				const name = { label: part.label, id: quads[0] };
				return { unit: part, quads, name, held: part.version !== undefined && (await this.holds(name)) };
			}),
		);
		this.versions.check(parts);
		for (const part of [...parts].reverse()) await this.writePart(part.unit, part.quads);
		this.versions.wrote(parts);
		return this.idOf(unit);
	}

	/** Writes one unit's record, each field in place of the quad of its predicate and a null removing it, then its edges. */
	private async writePart({ label, edges }: TUnit, [id, quads]: ReturnType<typeof individualAsQuads>): Promise<void> {
		const held: TQuad[] = [];
		for (const quad of quads)
			if (quad.object === null) await this.removeNow({ label, id, field: quad.predicate });
			else held.push(quad);
		await this.quads.setMany(held);
		if (edges !== undefined)
			for (const { rel, label: objectType, id: object, target } of edges) {
				if (target === EDGE_TARGET.only) await this.removeNow({ label, id, field: rel });
				await this.quads.add({ subject: id, predicate: rel, object, namedGraph: label, objectType });
			}
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
