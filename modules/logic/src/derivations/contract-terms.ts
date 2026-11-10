/**
 * The terms of a call's check against its step's contract. A statement asserts the list of its arguments related to true by its
 * relation's predicate; in a call's check each argument is the call's value of it: a parameter's value, the products, the
 * principal, a field, or the record a derivation names by the call's values of its arguments. A value that names a record by its `id`, or a reference to a record by its typed CURIE, is that record's
 * IRI. The call's facts state each field of a value that names a record and of each record the check read, under haibun's
 * vocabulary, so a relation's rules read them. The query selects each relation's triples.
 */
import { DataFactory } from "n3";
import type { NamedNode, Quad, Term } from "@rdfjs/types";
import { HAIBUN_NS } from "@haibun/core/lib/domains/resources.js";
import { LOG, RDF } from "@haibun/core/lib/domains/vocabularies.js";
import { NODE_KEY, recordOfCurie, referenceTo, type TRecordName } from "@haibun/core/lib/records/domains/unit.js";
import {
	FIELD_NAMESPACE,
	RELATION_NAMESPACE,
	type TContractArgument,
	type TContractCall,
	type TDerived,
	type TField,
	type TRelation,
	type TStatement,
} from "@haibun/core/lib/steps/domains/contract.js";
import type { TNamedRecord } from "../pipelines/reads.js";
import { dateTimeOf, listItems, pattern, patternText, quadsOf, ruleText, termOf, type TN3List, type TN3Part, type TN3Pattern } from "./n3.js";

const { namedNode } = DataFactory;

/** A value of a call as a part of a statement: a term, or a list of a value that is a list. */
type TCallTerm = Term | TN3List;

/** The predicate a relation's triples state. */
export const relationPredicate = ({ name }: Pick<TRelation, "name">): NamedNode => namedNode(`${RELATION_NAMESPACE}${name}`);

/** Returns the record a value refers to by its typed CURIE, where it is a reference. */
const referenceOf = (value: unknown): TRecordName | undefined =>
	typeof value === "object" && value !== null && NODE_KEY.id in value ? recordOfCurie((value as Record<string, unknown>)[NODE_KEY.id]) : undefined;

/** Returns the id a value names a record by: the id it states, or the id its reference names. */
function recordIdOf(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	if ("id" in value && typeof value.id === "string") return value.id;
	return referenceOf(value)?.id;
}

/** Returns a value of a call as a term: a record by its IRI, a list by its items, a time as an xsd:dateTime, else the value's term. */
function callTermOf(value: unknown): TCallTerm {
	const id = recordIdOf(value);
	if (id !== undefined) return termOf(id);
	if (Array.isArray(value)) return { list: value.map(callTermOf) };
	if (value instanceof Date) return dateTimeOf(value.toISOString());
	return termOf(value);
}

/** Returns the value of a derived argument from the derivation and the call's values of its arguments. In a dispatch check it is the
 *  reference to the record whose id the derivation returns. */
export type TDerive = (derived: TDerived, values: readonly string[]) => unknown;
const derivedRecord: TDerive = ({ persistedAs, derivation }, values) => referenceTo(persistedAs, derivation(...values));

/** Returns the call's value of an argument: the parameter's value, the products, the principal, or the derived record's value
 *  `derive` returns. Throws where the call doesn't state the value, or the argument is a field. */
function argumentValueOf(call: TContractCall, argument: TContractArgument, derive: TDerive): unknown {
	if ("parameter" in argument) {
		if (!(argument.parameter in call.parameters)) throw new Error(`a contract's statement names {${argument.parameter}}, which the call doesn't state`);
		return call.parameters[argument.parameter];
	}
	if ("products" in argument) {
		if (call.products === undefined) throw new Error("a contract's statement names the products, which a call holds once its action returned them; state it in `states`");
		return call.products;
	}
	if ("principal" in argument) {
		if (call.principal === undefined) throw new Error("a contract's statement names the principal, and actuality acting as itself doesn't state one");
		return call.principal;
	}
	if (!("derived" in argument)) throw new Error(`a derivation reads the field ${argument.persistedAs}.${argument.key}, and a derivation reads a call's values`);
	const values = argument.derived.args.map((inner) => argumentValueOf(call, inner, derive));
	const text = values.filter((value) => typeof value === "string");
	if (text.length !== values.length) throw new Error(`the derivation ${argument.derived.derivation.name} reads a value that isn't text, and a derivation reads text`);
	return derive(argument.derived, text);
}

/** Returns the term of a statement's argument in a call: the term of the call's value of it, or the field's IRI. */
const argumentTermOf = (call: TContractCall, argument: TContractArgument, derive: TDerive): TCallTerm =>
	"key" in argument ? namedNode(`${FIELD_NAMESPACE}${argument.persistedAs}.${argument.key}`) : callTermOf(argumentValueOf(call, argument, derive));

/** Returns the triple a statement asserts in a call, each derived argument's value as `derive` returns it. */
export const statementTriple = (call: TContractCall, { relation, args }: TStatement, derive: TDerive): TN3Pattern =>
	pattern({ list: args.map((argument) => argumentTermOf(call, argument, derive)) }, relationPredicate(relation), termOf(true));
/** Returns the triple a statement asserts in a dispatch check, each derived argument the reference to its record. */
export const callTriple = (call: TContractCall, statement: TStatement): TN3Pattern => statementTriple(call, statement, derivedRecord);

/** Returns the records a call's values and the derived arguments of `statements` refer to by their typed CURIEs, which its check reads. */
export function referencedRecords(call: TContractCall, statements: readonly TStatement[]): TRecordName[] {
	const derived = statements.flatMap(({ args }) => args.flatMap((argument) => ("derived" in argument ? [argumentValueOf(call, argument, derivedRecord)] : [])));
	const values = [...Object.values(call.parameters), ...(call.products === undefined ? [] : [call.products]), ...derived];
	return values.flatMap((value) => {
		const named = referenceOf(value);
		return named === undefined ? [] : [named];
	});
}

/** Returns the facts of a record's fields about its id, a list field as one fact of each item. A field that holds a record or
 *  isn't stated doesn't state a fact. */
const recordFacts = (id: string, fields: Readonly<Record<string, unknown>>): TN3Pattern[] =>
	Object.entries(fields).flatMap(([key, held]) =>
		(Array.isArray(held) ? held : [held]).flatMap((item: unknown) =>
			key === "id" || key.startsWith("@") || item === undefined || item === null || (typeof item === "object" && !(item instanceof Date))
				? []
				: [pattern(termOf(id) as NamedNode, namedNode(`${HAIBUN_NS}${key}`), termOf(item))],
		),
	);

/** Returns the facts of a call: each field of each value that states a record, and of each record `read` holds. */
export function callFacts(call: TContractCall, read: readonly TNamedRecord[]): string {
	const values = [...Object.values(call.parameters), ...(call.products === undefined ? [] : [call.products])];
	const stated = values.flatMap((value) => {
		const id = recordIdOf(value);
		return id === undefined || referenceOf(value) !== undefined ? [] : [{ id, fields: value as Record<string, unknown> }];
	});
	return [...stated, ...read].flatMap(({ id, fields }) => recordFacts(id, fields).map(patternText)).join("\n");
}

/** The predicate a field states as a fact. */
export const fieldPredicate = ({ key }: Pick<TField, "key">): string => `${HAIBUN_NS}${key}`;

/** Returns the predicates of haibun's vocabulary each relation's rules read, with those of each relation its rules read. */
export function relationReads(relations: readonly TRelation[]): Map<string, ReadonlySet<string>> {
	const direct = new Map(
		relations.map((relation) => {
			const quads = quadsOf(relation.rules);
			const conclusions = new Set(quads.filter(({ predicate }) => predicate.value === LOG.implies).map(({ object }) => object.value));
			const premises = quads.filter(({ graph }) => graph.termType !== "DefaultGraph" && !conclusions.has(graph.value)).map(({ predicate }) => predicate.value);
			return [relationPredicate(relation).value, premises] as const;
		}),
	);
	const readsOf = (predicate: string, seen: ReadonlySet<string>): string[] => {
		const premises = direct.get(predicate);
		if (premises === undefined || seen.has(predicate)) return [];
		const within = new Set([...seen, predicate]);
		return premises.flatMap((read) => (read.startsWith(HAIBUN_NS) ? [read] : readsOf(read, within)));
	};
	return new Map(relations.map(({ name }) => [name, new Set(readsOf(relationPredicate({ name }).value, new Set()))]));
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
