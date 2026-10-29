/**
 * The graph of one actuality's records the device holds, as an `IQuadStore`: its quads, read as records. A view reads what
 * the page holds by the reads it sends the site, so a view offline reads the records the site already served this reader.
 */
import type { z } from "zod";
import { RecordSchema } from "@haibun/core/lib/domains/json-text.js";
import { storeScopeFor, withinAccess, type AccessQueryLevel } from "@haibun/core/lib/domains/resources.js";
import type { TClusteredQuads, TDensityQuery, TDensityResult, TDistinctValues, TGraphQuery, TQuad, TQuadPattern, TRecordsPage, TRecordType } from "@haibun/core/lib/quad-types.js";
import { distinctOf, type TReadDeclarations } from "@haibun/core/lib/records/derivations/read-records.js";
import { assertRegisteredSchema, typedRecord } from "@haibun/core/lib/quad-types.js";
import { readQuadRecords } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { densityOverQuadStore } from "@haibun/core/lib/quad-store.js";
import { sliceQuadsPerType } from "@haibun/core/lib/steps/derivations/quad-sample.js";
import type { TDeviceGraph, TDeviceQuads, TGraphSaturation } from "../ports.js";
import { individualAsQuads, levelsOf, subjectKey } from "../derivations/quads.js";

export class DeviceGraph implements TDeviceGraph {
	readonly database: string;

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

	set(subject: string, predicate: string, object: unknown, namedGraph: string, properties?: Record<string, unknown>): Promise<void> {
		return this.quads.set(subject, predicate, object, namedGraph, properties);
	}

	get(subject: string, predicate: string, namedGraph?: string): Promise<unknown | undefined> {
		return this.quads.get(subject, predicate, namedGraph);
	}

	add(quad: Omit<TQuad, "timestamp">): Promise<void> {
		return this.quads.add(quad);
	}

	query(pattern: TQuadPattern): Promise<TQuad[]> {
		return this.quads.query(pattern);
	}

	clear(namedGraph?: string): Promise<void> {
		return this.quads.clear(namedGraph);
	}

	remove(pattern: TQuadPattern): Promise<void> {
		return this.quads.remove(pattern);
	}

	all(): Promise<TQuad[]> {
		return this.quads.all();
	}

	setMany(quads: TQuad[]): Promise<void> {
		return this.quads.setMany(quads);
	}

	async upsertIndividual(label: string, data: unknown): Promise<string> {
		const [id, quads] = individualAsQuads(label, RecordSchema.parse(data));
		await this.quads.setMany(quads);
		return id;
	}

	deleteIndividual(label: string, id: string): Promise<void> {
		return this.quads.remove({ subject: id, namedGraph: label });
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
