/**
 * The terms of a call's check against its step's contract. A statement asserts the list of its arguments related to true by its
 * relation's predicate; in a call's check each argument is the call's value of it: a parameter's value, the products, the
 * principal, a field, or the record a derivation names by the call's values of its arguments. A node that states a record's type and
 * id, or a reference to a record by its typed CURIE, is that record's IRI. The call's facts state each record a node of the call states
 * and each record the check read, as the records' terms state them: each field under the IRI its type declares, so a relation's
 * rules and the ontology's axioms read one vocabulary. The query selects each relation's triples.
 */
import { DataFactory } from "n3";
import type { NamedNode, Quad, Term } from "@rdfjs/types";
import { LOG, RDF } from "@haibun/core/lib/domains/vocabularies.js";
import { curieOf, NODE_KEY, recordOfCurie, referenceTo, type TRecordName } from "@haibun/core/lib/records/domains/unit.js";
import { declaredFieldIri } from "@haibun/core/lib/domains/hypermedia.js";
import type { TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
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
import { persistedDomainOf } from "@haibun/core/lib/domains/domains.js";
import type { TFact } from "../domains/logic.js";
import { dateTimeOf, listItems, pattern, quadsOf, quadsText, ruleText, termOf, type TN3List, type TN3Part, type TN3Pattern, type TRecordTerms } from "./n3.js";

const { namedNode } = DataFactory;

/** A value of a call as a part of a statement: a term, or a list of a value that is a list. */
type TCallTerm = Term | TN3List;

/** The predicate a relation's triples state. */
export const relationPredicate = ({ name }: Pick<TRelation, "name">): NamedNode => namedNode(`${RELATION_NAMESPACE}${name}`);

/** Returns the record a value refers to by its typed CURIE, where it is a reference. */
const referenceOf = (value: unknown): TRecordName | undefined =>
	typeof value === "object" && value !== null && NODE_KEY.id in value ? recordOfCurie((value as Record<string, unknown>)[NODE_KEY.id]) : undefined;

/** Returns the IRI of the record a name names. */
export type TIndividualOf = (name: TRecordName) => NamedNode;

/** Returns the record a node of a call states by its type and id, where the value is such a node. */
function statedName(value: unknown): TRecordName | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value) || referenceOf(value) !== undefined) return undefined;
	const { [NODE_KEY.type]: label, id } = value as Record<string, unknown>;
	if (typeof id !== "string") return undefined;
	if (typeof label !== "string")
		throw new Error(
			`a call's value names the record ${id} without its type, so its check doesn't have the record's IRI. State the value's domain as a stored type, or reference the record by its typed CURIE`,
		);
	return { label, id };
}

/** Returns the record a value of a call names: a node that states it, or a reference. */
const namedBy = (value: unknown): TRecordName | undefined => referenceOf(value) ?? statedName(value);

/** Returns a value of a call as a term: a record by its IRI, a list by its items, a time as an xsd:dateTime, else the value's term. */
function callTermOf(value: unknown, individualOf: TIndividualOf): TCallTerm {
	const named = namedBy(value);
	if (named !== undefined) return individualOf(named);
	if (Array.isArray(value)) return { list: value.map((item) => callTermOf(item, individualOf)) };
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
const argumentTermOf = (call: TContractCall, argument: TContractArgument, derive: TDerive, individualOf: TIndividualOf): TCallTerm =>
	"key" in argument ? namedNode(`${FIELD_NAMESPACE}${argument.persistedAs}.${argument.key}`) : callTermOf(argumentValueOf(call, argument, derive), individualOf);

/** Returns the triple a statement asserts in a call, each derived argument's value as `derive` returns it, and each record as
 *  `individualOf` names it. */
export const statementTriple = (call: TContractCall, { relation, args }: TStatement, derive: TDerive, individualOf: TIndividualOf): TN3Pattern =>
	pattern({ list: args.map((argument) => argumentTermOf(call, argument, derive, individualOf)) }, relationPredicate(relation), termOf(true));
/** Returns the triple a statement asserts in a dispatch check, each derived argument the reference to its record, and each record
 *  its IRI in `terms`. */
export const callTriple = (call: TContractCall, statement: TStatement, terms: TRecordTerms): TN3Pattern =>
	statementTriple(call, statement, derivedRecord, (name) => terms.individualAt(curieOf(name)));

/** Returns the records a call's values and the derived arguments of `statements` refer to by their typed CURIEs, which its check reads. */
export function referencedRecords(call: TContractCall, statements: readonly TStatement[]): TRecordName[] {
	const derived = statements.flatMap(({ args }) => args.flatMap((argument) => ("derived" in argument ? [argumentValueOf(call, argument, derivedRecord)] : [])));
	const values = [...Object.values(call.parameters), ...(call.products === undefined ? [] : [call.products]), ...derived];
	return values.flatMap((value) => {
		const named = referenceOf(value);
		return named === undefined ? [] : [named];
	});
}

/** Returns the facts of a record's fields, a list field as one fact of each item. An `@` key, the id, and a field that isn't
 *  stated, or that holds a value other than a reference or a time, don't state a fact. */
const factsOf = ({ label, id }: TRecordName, fields: Readonly<Record<string, unknown>>): TFact[] =>
	Object.entries(fields).flatMap(([key, held]) =>
		(Array.isArray(held) ? held : [held]).flatMap((object: unknown): TFact[] =>
			key === "id" ||
			key.startsWith("@") ||
			object === undefined ||
			object === null ||
			(typeof object === "object" && !(object instanceof Date) && referenceOf(object) === undefined)
				? []
				: [{ subject: id, predicate: key, object, namedGraph: label }],
		),
	);

/** Returns the facts of a call as `terms` states them: each record a node of the call states, and each record `read` holds. */
export function callFacts(call: TContractCall, read: readonly TNamedRecord[], terms: TRecordTerms): string {
	const values = [...Object.values(call.parameters), ...(call.products === undefined ? [] : [call.products])];
	const stated = values.flatMap((value): TNamedRecord[] => {
		const name = statedName(value);
		return name === undefined ? [] : [{ name, fields: value as Record<string, unknown> }];
	});
	return quadsText([...stated, ...read].flatMap(({ name, fields }) => terms.statements(name.label, factsOf(name, fields))));
}

/** The IRI a field states as a fact: the IRI its type declares for it. Throws where the steppers don't declare the type. */
export function fieldPredicate(domains: Record<string, TRegisteredDomain>, { persistedAs, key }: TField): string {
	const domain = persistedDomainOf(domains, persistedAs);
	if (domain === undefined) throw new Error(`a contract states the field ${persistedAs}.${key} complete, and the loaded steppers don't declare ${persistedAs}`);
	return declaredFieldIri(domain.topology, key);
}

/** The namespace of N3's built-ins, such as `log:notIncludes`, which a rule reads and a record doesn't state. */
const N3_BUILT_INS = "http://www.w3.org/2000/10/swap/";
/** The predicates that state a list's structure, as a rule states the list of a relation's arguments, which a record doesn't state. */
const LIST_STRUCTURE: ReadonlySet<string> = new Set([RDF.first, RDF.rest]);
/** Whether a premise of a rule reads a record's field: it isn't a built-in or a list's structure. */
const readsField = (predicate: string): boolean => !predicate.startsWith(N3_BUILT_INS) && !LIST_STRUCTURE.has(predicate);

/** Returns the fields each relation's rules read, by their IRIs, with those of each relation its rules read. */
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
		return premises.flatMap((read) => (read.startsWith(RELATION_NAMESPACE) ? readsOf(read, within) : readsField(read) ? [read] : []));
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
