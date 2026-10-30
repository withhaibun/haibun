/**
 * Reads the records a caller's query states: its class expression compiles to the filters a store's index runs, and where a part
 * needs entailment, the reasoner reads the members it entails and the read narrows to them. The page states where each part ran.
 */
import type { TWorld } from "../../actuality/domains/world.js";
import { proverOf } from "../../actuality/pipelines/step-dispatch.js";
import { counted } from "../../domains/hypermedia.js";
import { errorDetail } from "../../domains/util.js";
import {
	DensityQuerySchema,
	GraphQuerySchema,
	type TDensityQuery,
	type TDensityRequest,
	type TGraphQuery,
	type TGraphQueryResult,
	type TRan,
	type TRecordQuery,
} from "../../steps/domains/quad-types.js";
import { allOf, manchesterOf } from "../domains/class-expression.js";
import { parseClassExpression } from "../derivations/class-expression.js";
import { compiledExpression } from "../derivations/compiled-expression.js";
import { filterableOf, readDeclarationsOf } from "../derivations/read-records.js";

/** A store's read of a compiled query: its page, or why the store refuses it. */
export type TRecordRead = (query: TGraphQuery) => Promise<TGraphQueryResult | { refused: string }>;

/** Returns the parts of `expression` as the world's declarations compile them within `label`, or why it doesn't read. */
function compiledIn(world: TWorld, expression: string, label: string | undefined): ReturnType<typeof compiledExpression> | { refused: string } {
	try {
		return compiledExpression(parseClassExpression(expression), label, filterableOf(readDeclarationsOf(world.domains, world.runtime.records)));
	} catch (caught) {
		return { refused: errorDetail(caught) };
	}
}

/** Returns the count `request` states with its expression compiled to the filters a store's index counts by, or why it doesn't
 *  compile: a count reads the index alone, so a part the reasoner entails is refused. */
export function compiledDensity(world: TWorld, request: TDensityRequest): TDensityQuery | { refused: string } {
	const { expression, ...stated } = request;
	if (expression === undefined) return DensityQuerySchema.parse(stated);
	const compiled = compiledIn(world, expression, stated.label);
	if ("refused" in compiled) return compiled;
	if (compiled.entailed !== undefined)
		return { refused: `a count reads the store's index, and \`${compiled.ran.reasoner}\` needs the reasoner: count the members \`individuals of\` returns` };
	return DensityQuerySchema.parse({ ...stated, filters: compiled.filters });
}

/** A caller's query compiled to a store's read: the read, where each part of its expression ran, and whether the members the
 *  reasoner entails are a floor; or that the members the reasoner entails are empty; or why it doesn't compile. */
export type TCompiledRead = { query: TGraphQuery; ran?: TRan; floor: boolean } | { none: TRan } | { refused: string };

/** Returns `query` compiled to a store's read: its expression's index part as filters, and a part that needs entailment as the
 *  members the reasoner entails, which needs a type. */
export async function compiledRead(world: TWorld, query: TRecordQuery): Promise<TCompiledRead> {
	const { expression, ...stated } = query;
	if (expression === undefined) return { query: GraphQuerySchema.parse(stated), floor: false };
	const compiled = compiledIn(world, expression, stated.label);
	if ("refused" in compiled) return compiled;
	const { label, filters, entailed, ran } = compiled;
	const narrowed = { ...stated, ...(label === undefined ? {} : { label }), filters };
	if (entailed === undefined) return { query: GraphQuerySchema.parse(narrowed), ran, floor: false };
	if (label === undefined) return { refused: `the reasoner reads \`${ran.reasoner}\` across types: name the type of the records in label, or read them with \`individuals of\`` };
	const { members, truncated } = await proverOf(world).entailed(world, manchesterOf(allOf([{ named: label }, entailed])));
	const named = members.filter(({ persistedAs }) => persistedAs === label).map(({ id }) => id);
	// The reasoner's reads stopped at its ceiling, so the members it entails are a floor and so is the count.
	return named.length === 0 ? { none: ran } : { query: GraphQuerySchema.parse({ ...narrowed, named }), ran, floor: truncated.length > 0 };
}

/** Returns the page of the records `query` states, read through `read`, with where each part of its expression ran, or why it
 *  doesn't read. */
export async function readRecordQuery(world: TWorld, query: TRecordQuery, read: TRecordRead): Promise<TGraphQueryResult | { refused: string }> {
	const compiled = await compiledRead(world, query);
	if ("refused" in compiled) return compiled;
	if ("none" in compiled) return { vertices: [], ...counted(0), ran: compiled.none };
	const page = await read(compiled.query);
	if ("refused" in page) return page;
	return { ...page, ...(compiled.floor ? { saturated: true } : {}), ...(compiled.ran === undefined ? {} : { ran: compiled.ran }) };
}
