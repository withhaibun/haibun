/**
 * Compiles a class expression to the filters a store's index runs: a named class that is a type the store holds is the type it
 * reads, a field's or a relation's `value` is `eq`, an `or` of one property's values is `in`, a facet is a comparison, and a
 * `pattern` of plain text is `contains`. The rest, a subclass, `some` over a relation, `inverse`, a field the type doesn't
 * declare or a pattern that isn't plain text, needs entailment, so the reasoner reads it. The result states each part in
 * Manchester syntax, so a page and a proof name where it ran.
 */
import { itemAt } from "../../domains/item-at.js";
import type { TRan, TSearchCondition } from "../../steps/domains/quad-types.js";
import { allOf, FACET, manchesterOf, type TClassExpression, type TFacet } from "../domains/class-expression.js";

/** A compiled expression: the type it reads, the filters the index runs, the part the reasoner entails, and where each ran. */
export type TCompiledExpression = { label?: string; filters: TSearchCondition[]; entailed?: TClassExpression; ran: TRan };
/** The types a store holds, and the fields and relations a filter of each names. */
export type TFilterable = { types: readonly string[]; fieldsOf: (label: string) => readonly string[] };

/** The comparison each ordering facet runs as. */
const COMPARED: Record<Exclude<TFacet, typeof FACET.pattern>, TSearchCondition["operator"]> = {
	[FACET.atLeast]: "gte",
	[FACET.above]: "gt",
	[FACET.atMost]: "lte",
	[FACET.below]: "lt",
};
/** A pattern's characters that aren't plain text, which `contains` doesn't match as a pattern does. */
const PATTERN_SYNTAX = /[\\^$.|?*+()[\]{}]/;

/** Returns the id of a record's address, `Type:id`, which a relation's filter matches at its other end. */
const idOfAddress = (address: string): string => address.slice(address.indexOf(":") + 1);

/** Returns the filters of a restriction the index runs on `fields`, or undefined where it needs entailment. */
function filtersOf(part: TClassExpression, fields: readonly string[]): TSearchCondition[] | undefined {
	if ("or" in part) {
		const each = part.or.map((alternative) => filtersOf(alternative, fields));
		const predicates = new Set(each.map((held) => (held?.length === 1 && held[0]?.operator === "eq" ? held[0].predicate : undefined)));
		const [predicate] = predicates;
		if (predicates.size !== 1 || predicate === undefined) return undefined;
		const values = each.flatMap((held) => (held === undefined ? [] : held.map(({ value }) => value)));
		return [{ predicate, operator: "in", value: itemAt(values, 0), values }];
	}
	if (!("property" in part) || part.inverse || !fields.includes(part.property)) return undefined;
	if ("literal" in part) return [{ predicate: part.property, operator: "eq", value: part.literal.lexical }];
	if ("value" in part) return [{ predicate: part.property, operator: "eq", value: idOfAddress(part.value) }];
	if (!("range" in part)) return undefined;
	const facets = part.range.facets.map(({ facet, literal }) => {
		if (facet !== FACET.pattern) return { predicate: part.property, operator: COMPARED[facet], value: literal.lexical };
		return PATTERN_SYNTAX.test(literal.lexical) ? undefined : { predicate: part.property, operator: "contains" as const, value: literal.lexical };
	});
	return facets.every((facet) => facet !== undefined) ? facets : undefined;
}

/** Returns the read `expression` states within `label`, where a read names one: the type, the filters of the index, and the
 *  part the reasoner entails. */
export function compiledExpression(expression: TClassExpression, label: string | undefined, filterable: TFilterable): TCompiledExpression {
	const parts = "and" in expression ? expression.and : [expression];
	const typed = parts.flatMap((part) => ("named" in part && filterable.types.includes(part.named) && (label === undefined || label === part.named) ? [part.named] : []));
	const read = label === undefined ? typed[0] : label;
	const fields = read === undefined ? [] : filterable.fieldsOf(read);
	const indexed: TClassExpression[] = [];
	const entailed: TClassExpression[] = [];
	const filters: TSearchCondition[] = [];
	for (const part of parts) {
		const held = "named" in part ? (part.named === read ? [] : undefined) : filtersOf(part, fields);
		if (held === undefined) entailed.push(part);
		else {
			indexed.push(part);
			filters.push(...held);
		}
	}
	const ran: TRan = { ...(indexed.length === 0 ? {} : { index: manchesterOf(allOf(indexed)) }), ...(entailed.length === 0 ? {} : { reasoner: manchesterOf(allOf(entailed)) }) };
	return { ...(read === undefined ? {} : { label: read }), filters, ...(entailed.length === 0 ? {} : { entailed: allOf(entailed) }), ran };
}

/** Returns `expression` compiled within `label` for a read that runs a store's index alone, which `reader` names: a part that
 *  needs entailment throws, naming the part and the reader. */
export function indexCompiled(expression: TClassExpression, label: string | undefined, filterable: TFilterable, reader: string): TCompiledExpression {
	const compiled = compiledExpression(expression, label, filterable);
	if (compiled.entailed !== undefined) throw new Error(`${reader} runs a store's index alone, and \`${compiled.ran.reasoner}\` needs the reasoner`);
	return compiled;
}
