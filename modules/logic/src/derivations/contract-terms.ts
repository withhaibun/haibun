/**
 * The terms of a call's check against its step's contract. A statement asserts the list of its arguments related to true by its
 * relation's predicate; in a call's check each argument is the call's value of it: a parameter's value, the products, the
 * principal or a field. A value that names a record by its `id` is that record's IRI, and the call's facts state each field of
 * such a value, under haibun's vocabulary, so a relation's rules read them. The query selects each relation's triples.
 */
import { DataFactory } from "n3";
import type { NamedNode, Quad, Term } from "@rdfjs/types";
import { HAIBUN_NS } from "@haibun/core/lib/domains/resources.js";
import { RDF } from "@haibun/core/lib/domains/vocabularies.js";
import { FIELD_NAMESPACE, RELATION_NAMESPACE, type TContractArgument, type TContractCall, type TRelation, type TStatement } from "@haibun/core/lib/steps/domains/contract.js";
import { dateTimeOf, listItems, pattern, patternText, ruleText, termOf, type TN3List, type TN3Part, type TN3Pattern } from "./n3.js";

const { namedNode } = DataFactory;

/** A value of a call as a part of a statement: a term, or a list of a value that is a list. */
type TCallTerm = Term | TN3List;

/** The predicate a relation's triples state. */
export const relationPredicate = ({ name }: Pick<TRelation, "name">): NamedNode => namedNode(`${RELATION_NAMESPACE}${name}`);

/** Returns the id a value names a record by, where it is an object that states one. */
const recordIdOf = (value: unknown): string | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value) && "id" in value && typeof value.id === "string" ? value.id : undefined;

/** Returns a value of a call as a term: a record by its IRI, a list by its items, a time as an xsd:dateTime, else the value's term. */
function callTermOf(value: unknown): TCallTerm {
	const id = recordIdOf(value);
	if (id !== undefined) return termOf(id);
	if (Array.isArray(value)) return { list: value.map(callTermOf) };
	if (value instanceof Date) return dateTimeOf(value.toISOString());
	return termOf(value);
}

/** Returns the term of a statement's argument in a call: the call's value of the parameter, the products or the principal, or the
 *  field's IRI. Throws where the call doesn't state the value. */
function argumentTermOf(call: TContractCall, argument: TContractArgument): TCallTerm {
	if ("parameter" in argument) {
		if (!(argument.parameter in call.parameters)) throw new Error(`a contract's statement names {${argument.parameter}}, which the call doesn't state`);
		return callTermOf(call.parameters[argument.parameter]);
	}
	if ("products" in argument) {
		if (call.products === undefined) throw new Error("a contract's statement names the products, which a call holds once its action returned them; state it in `states`");
		return callTermOf(call.products);
	}
	if ("principal" in argument) {
		if (call.principal === undefined) throw new Error("a contract's statement names the principal, and actuality acting as itself doesn't state one");
		return termOf(call.principal);
	}
	return namedNode(`${FIELD_NAMESPACE}${argument.persistedAs}.${argument.key}`);
}

/** Returns the triple a statement asserts in a call. */
export const statementTriple = (call: TContractCall, { relation, args }: TStatement): TN3Pattern =>
	pattern({ list: args.map((argument) => argumentTermOf(call, argument)) }, relationPredicate(relation), termOf(true));

/** Returns the facts of a call: each field of each value that names a record, a list field as one fact of each item. */
export function callFacts(call: TContractCall): string {
	const values = [...Object.values(call.parameters), ...(call.products === undefined ? [] : [call.products])];
	const facts = values.flatMap((value) => {
		const id = recordIdOf(value);
		if (id === undefined || typeof value !== "object" || value === null) return [];
		return Object.entries(value).flatMap(([key, held]) =>
			key === "id" || held === undefined || held === null || typeof held === "object" ? [] : [pattern(termOf(id) as NamedNode, namedNode(`${HAIBUN_NS}${key}`), termOf(held))],
		);
	});
	return facts.map(patternText).join("\n");
}

/** Returns the query that selects each triple of each relation. */
export const relationsQuery = (relations: readonly TRelation[]): string =>
	relations.map((relation) => ruleText([pattern("?arguments", relationPredicate(relation), "?holds")], [pattern("?arguments", relationPredicate(relation), "?holds")])).join("\n");

/** Returns a part of a triple as the key a comparison reads: a term by its type and value, a list by its items. A list the quads
 *  state through `rdf:first` and `rdf:rest` reads as its items. */
function partKey(part: TN3Part, quads: readonly Quad[]): string {
	if ("formula" in part) throw new Error("a relation's triple states a formula as an argument, and a statement's argument is a term or a list");
	if ("list" in part) return `(${part.list.map((item) => partKey(item, quads)).join(" ")})`;
	if (part.termType === "BlankNode" || (part.termType === "NamedNode" && part.value === RDF.nil))
		return `(${listItems(quads, part)
			.map((item) => partKey(item, quads))
			.join(" ")})`;
	return `${part.termType} ${part.value}`;
}

/** Returns the key of a relation's triple: its predicate, and its arguments' list. */
export const tripleKey = (subject: TN3Part, predicate: Term, quads: readonly Quad[]): string => `${predicate.value} ${partKey(subject, quads)}`;
