/**
 * Writes a store's values as N3 terms, and reads the triples EYE derives back from its N3 output. An absolute IRI is an IRI,
 * a finite number and a boolean are their own literals, and every other string is a string literal. A record is an
 * individual of its type's class, named by its record IRI as the served context expands it.
 */
import type { TConcernCatalog } from "@haibun/core/lib/domains/hypermedia.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import type { TRecordNamespace } from "@haibun/core/lib/domains/resources.js";
import { iriIn } from "@haibun/core/lib/records/derivations/owl.js";
import { recordIri, recordOfIri } from "@haibun/core/lib/records/derivations/record-iri.js";
import type { TFact } from "../domains/logic.js";
import type { TTriple } from "../domains/reasoning.js";

const ABSOLUTE_IRI = /^[a-z][a-z\d+.-]*:[^\s<>"{}|\\^`]+$/i;
/** One term of an N3 line as EYE writes it with full IRIs: an IRI, a literal with its datatype or language, a number or a boolean. */
const TERM = /<[^>]*>|"(?:[^"\\]|\\.)*"(?:\^\^<[^>]*>|@[\w-]+)?|[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|true|false/g;
const TRIPLE_TERMS = 3;
const N3_PREFIX = "@prefix";

/** Returns a value as an N3 term. Throws where a value isn't a string, a finite number or a boolean. */
export function n3Term(value: unknown): string {
	if (typeof value === "string") return ABSOLUTE_IRI.test(value) ? `<${value}>` : JSON.stringify(value);
	if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean") return String(value);
	throw new Error(`a store's value ${JSON.stringify(value)} doesn't have an N3 term. Store a string, a finite number or a boolean.`);
}

/** Returns the triples of N3 text that states one triple per line, as EYE writes a query's result. Prefix and empty lines
 *  aren't triples. Throws at a line that states something else, such as a formula, which a query's result doesn't hold. */
export function triplesOf(text: string): TTriple[] {
	return text.split("\n").flatMap((line) => {
		if (line.trim() === "" || line.startsWith(N3_PREFIX)) return [];
		const terms = line.match(TERM);
		if (terms?.length !== TRIPLE_TERMS || !line.trimEnd().endsWith("."))
			throw new Error(`EYE derived \`${line}\`, which isn't one triple. Write the query's conclusion as triples.`);
		const [subject, predicate, object] = terms as [string, string, string];
		return [{ subject, predicate, object }];
	});
}

/** A field's or an edge's IRI, with the types an edge reaches. A field doesn't reach a type. */
type TFieldTerm = { iri: string; targets: readonly string[] };
/** A type's terms as N3 states them: its label, its class, and each field and edge by its IRI. */
type TTypeTerms = { label: string; classIri: string; fields: Map<string, TFieldTerm> };

/** The N3 terms of the records of the persisted types: each record as an individual of its type's class, and each of its
 *  facts as a triple whose predicate is the IRI its field or edge declares. An edge's value is the record it reaches. */
export type TRecordTerms = {
	/** A type's records and their facts as N3 statements, each record stated a member of its class. */
	statements: (label: string, facts: readonly TFact[]) => string;
	classIri: (label: string) => string;
	/** The store's pattern of an individual's IRI and a field's IRI, as a read built-in names them. */
	patternOf: (subject: string, predicate: string) => Required<Pick<TFact, "subject" | "predicate" | "namedGraph">>;
	/** A fact's object as an N3 term. */
	objectOf: (fact: TFact) => string;
	/** The address of the record an individual's IRI names, in angle brackets as N3 writes it. */
	addressOf: (iri: string) => { persistedAs: string; id: string };
	/** The IRI of the record at an address, `Type:id`. */
	individualAt: (address: string) => string;
};

/** Returns the N3 terms of the records of the types a concern catalog states, with each IRI from the served context, which
 *  binds the records' prefix. */
export function recordTerms(catalog: TConcernCatalog, context: Record<string, unknown>, records: TRecordNamespace): TRecordTerms {
	const types = new Map(
		Object.values(catalog.persisted).map(({ label, properties, edges }): [string, TTypeTerms] => [
			label,
			{
				label,
				classIri: iriIn(context, label),
				fields: new Map([
					...Object.entries(properties).map(([field, { term }]): [string, TFieldTerm] => [field, { iri: iriIn(context, term), targets: [] }]),
					...Object.entries(edges).map(([edge, { term, targets }]): [string, TFieldTerm] => [edge, { iri: iriIn(context, term), targets }]),
				]),
			},
		]),
	);
	const namespace = context[records.prefix];
	if (typeof namespace !== "string") throw new Error(`the served context doesn't bind the records' prefix ${records.prefix}. Pass the records to getJsonLdContext.`);
	const byLowerLabel = new Map([...types.keys()].map((label) => [label.toLowerCase(), label]));
	if (byLowerLabel.size < types.size)
		throw new Error(`two persisted types share a label in lower case, so their records share IRIs. Rename one of ${[...types.keys()].join(", ")}.`);
	const typeOf = (label: string): TTypeTerms => {
		const held = types.get(label);
		if (held === undefined) throw new Error(`${label} isn't a persisted type, so its records don't have N3 terms. Name a type the steppers declare.`);
		return held;
	};
	/** The IRI of a record of a persisted type: its record IRI, expanded through the context. */
	const individualOf = (label: string, id: string): string => iriIn(context, recordIri(records.prefix, typeOf(label).label, id));
	const fieldOf = (label: string, field: string): TFieldTerm => {
		const held = typeOf(label).fields.get(field);
		if (held === undefined) throw new Error(`${label} doesn't declare the field ${field}, so its facts don't have an N3 predicate. Declare the field in the type's topology.`);
		return held;
	};
	const objectOf = ({ namedGraph, predicate, object }: TFact): string => {
		const { targets } = fieldOf(namedGraph, predicate);
		if (targets.length === 0) return n3Term(object);
		if (targets.length > 1)
			throw new Error(
				`the edge ${predicate} of ${namedGraph} reaches ${targets.join(", ")}, so its value ${String(object)} doesn't name one record. Declare one range for the edge.`,
			);
		return `<${individualOf(itemAt(targets, 0), String(object))}>`;
	};
	const iriOf = (subject: string): { label: string; id: string } => {
		const named = subject.startsWith(namespace) ? recordOfIri(`${records.prefix}:${subject.slice(namespace.length)}`) : undefined;
		const label = named === undefined ? undefined : byLowerLabel.get(named.lowerLabel);
		if (named === undefined || label === undefined) throw new Error(`${subject} isn't the IRI of a record of a persisted type. Name a record as recordIri names it.`);
		return { label, id: named.id };
	};
	return {
		classIri: (label) => typeOf(label).classIri,
		statements: (label, facts) => {
			const { classIri } = typeOf(label);
			const subjects = [...new Set(facts.map(({ subject }) => subject))].map((id) => `<${individualOf(label, id)}> a <${classIri}> .`);
			return [...subjects, ...facts.map((fact) => `<${individualOf(label, fact.subject)}> <${fieldOf(label, fact.predicate).iri}> ${objectOf(fact)} .`)].join("\n");
		},
		patternOf: (subject, predicate) => {
			const { label, id } = iriOf(subject.slice(1, -1));
			const iri = predicate.slice(1, -1);
			const field = [...typeOf(label).fields].find(([, held]) => held.iri === iri);
			if (field === undefined) throw new Error(`${label} doesn't declare a field whose IRI is ${iri}. Read a field the type declares.`);
			return { subject: id, predicate: field[0], namedGraph: label };
		},
		objectOf,
		addressOf: (iri) => {
			const { label, id } = iriOf(iri.slice(1, -1));
			return { persistedAs: label, id };
		},
		individualAt: (address) => {
			const colon = address.indexOf(":");
			if (colon <= 0) throw new Error(`${address} isn't a record's address. Write it as Type:id.`);
			return individualOf(address.slice(0, colon), address.slice(colon + 1));
		},
	};
}
