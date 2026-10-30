/**
 * An in-memory store that reads the records of an actuality's types, for a test that writes an actuality and reads it through a view.
 */
import { HAIBUN_RECORD_NAMESPACE, type TDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { buildConcernCatalog } from "@haibun/core/lib/domains/hypermedia.js";
import { filterableOf, readDeclarationsOf } from "@haibun/core/lib/records/derivations/read-records.js";
import { indexCompiled, type TFilterable } from "@haibun/core/lib/records/derivations/compiled-expression.js";
import type { TClassExpression } from "@haibun/core/lib/records/domains/class-expression.js";
import { DensityQuerySchema, GraphQuerySchema } from "@haibun/core/lib/quad-types.js";
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import type { TActualityGraph } from "./ports.js";
import { storeOfDomains } from "@haibun/core/lib/test/declared-types.js";
import { seqPathDomainDefinition } from "@haibun/core/lib/seq-path.js";
import { logMessageDomainDefinition } from "@haibun/core/lib/domains/log-message.js";
import { runArtifactDomainDefinition } from "@haibun/core/lib/domains/run-artifact.js";

/** The declarations of the types actuality writes as it runs: its steps, what it logged and what it produced. */
export const ACTUALITY_DOMAIN_DEFINITIONS: TDomainDefinition[] = [seqPathDomainDefinition, logMessageDomainDefinition, runArtifactDomainDefinition];

/** Returns an in-memory store that reads the records of an actuality's types. */
export const actualityStore = () => storeOfDomains(ACTUALITY_DOMAIN_DEFINITIONS);

/** The types actuality writes and the fields a filter of each names, against which a page-built expression compiles. */
export const actualityFilterable = (): TFilterable => filterableOf(readDeclarationsOf(mapDefinitionsToDomains(ACTUALITY_DOMAIN_DEFINITIONS), HAIBUN_RECORD_NAMESPACE));

/** Each type actuality writes, with its fields by relation, as a test's catalog states them. */
export const ACTUALITY_RELS: Record<string, Record<string, string>> = Object.fromEntries(
	Object.entries(buildConcernCatalog(mapDefinitionsToDomains(ACTUALITY_DOMAIN_DEFINITIONS)).persisted).map(([label, concern]) => [
		label,
		Object.fromEntries(Object.entries(concern.properties).map(([field, { rel }]) => [field, rel])),
	]),
);

/** An actuality read over a store a test made: each page-built expression compiles to the store's filters by the fields of the
 *  types actuality writes. A store without the reasoner runs its index alone. */
export function actualityGraphOver(store: IQuadStore): TActualityGraph {
	const filterable = actualityFilterable();
	const filtersOf = (expression: TClassExpression | string | undefined, label: string | undefined) => {
		if (expression === undefined) return {};
		if (typeof expression === "string") throw new Error(`a test's store doesn't read a written expression: \`${expression}\` is read by the instance`);
		return { filters: indexCompiled(expression, label, filterable, "a test's store").filters };
	};
	return {
		query: ({ expression, ...stated }) => store.readRecords(GraphQuerySchema.parse({ ...stated, ...filtersOf(expression, stated.label) })),
		density: ({ expression, ...stated }) => store.density(DensityQuerySchema.parse({ ...stated, ...filtersOf(expression, stated.label) })),
		declares: (label) => filterable.types.includes(label),
	};
}
