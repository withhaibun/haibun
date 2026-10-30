/**
 * N3 through N3.js: a store's values as RDF/JS terms, a record's facts as quads N3.js writes, EYE's N3 output read by N3.js's
 * parser, and the formulas and rules EYE reads. A record is an individual of its type's class, named by its record IRI as the
 * served context expands it.
 *
 * The formula writer is the one exception to writing N3 through N3.js: N3.js writes Turtle, TriG and N-Quads, while N3 states
 * a formula as `{ … }` and a rule with `=>` (W3C Notation3 Language, Community Group report, the grammar's `formula`
 * production and the `=>` of its `verb` production), which N3.js doesn't write. EYE reads N3 only, so each triple pattern of a
 * formula is written by N3.js, which encodes and escapes every term, and the writer adds only the braces, a list's parentheses
 * and the rule's arrow, so a literal's text never reads as a formula or a list. A rule set that doesn't vary with the
 * declarations is an N3 file of its own under `src/rules`.
 */
import { DataFactory, Parser, Writer } from "n3";
import type { Literal, NamedNode, Quad, Quad_Object, Quad_Predicate, Quad_Subject, Term, Variable } from "@rdfjs/types";
import type { TConcernCatalog } from "@haibun/core/lib/domains/hypermedia.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import type { TRecordNamespace } from "@haibun/core/lib/domains/resources.js";
import { LOG, RDF, XSD } from "@haibun/core/lib/domains/vocabularies.js";
import { iriIn } from "@haibun/core/lib/records/derivations/owl.js";
import { recordIri, recordOfIri } from "@haibun/core/lib/records/derivations/record-iri.js";
import type { TFact } from "../domains/logic.js";

const { namedNode, literal, blankNode } = DataFactory;
const ABSOLUTE_IRI = /^[a-z][a-z\d+.-]*:[^\s<>"{}|\\^`]+$/i;
const writer = new Writer({ format: MEDIA_TYPE.n3 });

/** Returns a store's value as an RDF/JS term: an absolute IRI as a named node, a finite number and a boolean as typed literals,
 *  and every other string as a string literal. Throws where a value isn't a string, a finite number or a boolean. */
export function termOf(value: unknown): NamedNode | Literal {
	if (typeof value === "string") return ABSOLUTE_IRI.test(value) ? namedNode(value) : literal(value);
	if (typeof value === "number" && Number.isFinite(value)) return literal(String(value), namedNode(Number.isInteger(value) ? XSD.integer : XSD.decimal));
	if (typeof value === "boolean") return literal(String(value), namedNode(XSD.boolean));
	throw new Error(`a store's value ${JSON.stringify(value)} doesn't have an N3 term. Store a string, a finite number or a boolean.`);
}

/** A formula: the patterns between its braces. */
export type TN3Formula = { formula: readonly TN3Pattern[] };
/** A list, which N3 writes in parentheses: each item a term, a formula or a list. */
export type TN3List = { list: readonly TN3Part[] };
/** A part of a pattern N3 writes: a term, a formula or a list. */
type TN3Part = Term | TN3Formula | TN3List;
/** A triple pattern of a formula, whose subject or object may be a formula or a list of its own. */
export type TN3Pattern = { subject: Quad_Subject | TN3Formula | TN3List; predicate: Quad_Predicate; object: Quad_Object | TN3Formula | TN3List };

/** Returns a literal as a quad's subject. An N3 subject is any expression, a literal among them (W3C Notation3 Language, the grammar's
 *  `subject` production), which RDF/JS's quad doesn't type as a subject; N3.js writes one there as N3 reads it. */
export const literalSubject = (term: Literal): Quad_Subject => term as unknown as Quad_Subject;

/** The subject and the predicate N3.js writes a term after, so the term's own text is what follows them. */
const [HOLDER, HOLDING] = [blankNode("s"), namedNode(LOG.equalTo)];
const HELD_AFTER = `_:${HOLDER.value} <${HOLDING.value}> `;

/** Returns a part of a pattern as N3: N3.js writes a term, braces hold a formula's patterns, and parentheses a list's items, so a
 *  literal's text never reads as a formula or a list. */
function partText(part: TN3Part): string {
	if ("formula" in part) return formulaText(part);
	if ("list" in part) return `(${part.list.map((item) => ` ${partText(item)}`).join("")} )`;
	return writer
		.quadToString(HOLDER, HOLDING, part as Quad_Object)
		.trim()
		.slice(HELD_AFTER.length, -" .".length);
}

/** Returns a pattern as N3: its subject, its predicate and its object, each as `partText` writes it. */
export const patternText = ({ subject, predicate, object }: TN3Pattern): string => `${partText(subject)} ${partText(predicate)} ${partText(object)} .`;

/** Returns a formula as N3, its patterns between braces. */
export const formulaText = ({ formula }: TN3Formula): string => `{ ${formula.map(patternText).join(" ")} }`;

/** Returns a rule as N3: what its body derives as its head. */
export const ruleText = (body: readonly TN3Pattern[], head: readonly TN3Pattern[]): string =>
	patternText({ subject: { formula: body }, predicate: namedNode(LOG.implies), object: { formula: head } });

/** Each list cell of a reading's quads, by its node: its first item and the rest, held once for each array of quads. */
const cellsByQuads = new WeakMap<readonly Quad[], Map<string, { first?: Term; rest?: Term }>>();
const nodeKey = (node: Term): string => `${node.termType}:${node.value}`;
function cellsOf(quads: readonly Quad[]): Map<string, { first?: Term; rest?: Term }> {
	const held = cellsByQuads.get(quads);
	if (held !== undefined) return held;
	const cells = new Map<string, { first?: Term; rest?: Term }>();
	for (const { subject, predicate, object } of quads) {
		if (predicate.value !== RDF.first && predicate.value !== RDF.rest) continue;
		const key = nodeKey(subject);
		const cell = { ...cells.get(key), [predicate.value === RDF.first ? "first" : "rest"]: object };
		cells.set(key, cell);
	}
	cellsByQuads.set(quads, cells);
	return cells;
}

/** Returns the items of the list whose head is `node`, as quads N3.js read state it through `rdf:first` and `rdf:rest`. The quads'
 *  cells are indexed once, so reading a list takes time in its length. */
export function listItems(quads: readonly Quad[], node: Term): Term[] {
	const cells = cellsOf(quads);
	const items: Term[] = [];
	for (let at: Term = node; at.value !== RDF.nil; ) {
		const cell = cells.get(nodeKey(at));
		if (cell?.first === undefined || cell.rest === undefined)
			throw new Error(`the reasoner's output names a list ${at.value} its quads don't state. Check the rules that derive it.`);
		items.push(cell.first);
		at = cell.rest;
	}
	return items;
}

/** Returns quads as N3, each a triple N3.js writes. */
export const quadsText = (quads: readonly Quad[]): string => writer.quadsToString([...quads]);

/** A triple pattern of terms, with an IRI where a term is a vocabulary's or a variable's name after `?`. */
export const pattern = (
	subject: Quad_Subject | TN3Formula | TN3List | string,
	predicate: Quad_Predicate | string,
	object: Quad_Object | TN3Formula | TN3List | string,
): TN3Pattern => ({
	subject: typeof subject === "string" ? termNamed(subject) : subject,
	predicate: typeof predicate === "string" ? termNamed(predicate) : predicate,
	object: typeof object === "string" ? termNamed(object) : object,
});
/** A variable written `?name`, or else a named node. */
const termNamed = (name: string): NamedNode | Variable => (name.startsWith("?") ? DataFactory.variable(name.slice(1)) : namedNode(name));

/** Returns the quads of N3 text, read by N3.js's parser in N3 mode, which reads formulas and rules. */
export const quadsOf = (text: string): Quad[] => new Parser({ format: MEDIA_TYPE.n3 }).parse(text);

/** A field's or an edge's IRI, with the types an edge reaches. A field doesn't reach a type. */
type TFieldTerm = { iri: NamedNode; targets: readonly string[] };
/** A type's terms as N3 states them: its label, its class, and each field and edge by its IRI. */
type TTypeTerms = { label: string; classIri: NamedNode; fields: Map<string, TFieldTerm> };

/** The N3 terms of the records of the persisted types: each record as an individual of its type's class, and each of its
 *  facts as a triple whose predicate is the IRI its field or edge declares. An edge's value is the record it reaches. */
export type TRecordTerms = {
	/** A type's records and their facts as quads, each record stated a member of its class. */
	statements: (label: string, facts: readonly TFact[]) => Quad[];
	classIri: (label: string) => NamedNode;
	/** The store's pattern of an individual and a field's IRI, as a read built-in names them. */
	patternOf: (subject: Term, predicate: Term) => Required<Pick<TFact, "subject" | "predicate" | "namedGraph">>;
	/** A fact's object as a term. */
	objectOf: (fact: TFact) => Quad_Object;
	/** The address of the record an individual names. */
	addressOf: (individual: Term) => { persistedAs: string; id: string };
	/** The individual that is the record at an address, `Type:id`. */
	individualAt: (address: string) => NamedNode;
};

/** Returns the N3 terms of the records of the types a concern catalog states, with each IRI from the served context, which
 *  binds the records' prefix. */
export function recordTerms(catalog: TConcernCatalog, context: Record<string, unknown>, records: TRecordNamespace): TRecordTerms {
	const types = new Map(
		Object.values(catalog.persisted).map(({ label, properties, edges }): [string, TTypeTerms] => [
			label,
			{
				label,
				classIri: namedNode(iriIn(context, label)),
				fields: new Map([
					...Object.entries(properties).map(([field, { term }]): [string, TFieldTerm] => [field, { iri: namedNode(iriIn(context, term)), targets: [] }]),
					...Object.entries(edges).map(([edge, { term, targets }]): [string, TFieldTerm] => [edge, { iri: namedNode(iriIn(context, term)), targets }]),
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
	const individualOf = (label: string, id: string): NamedNode => namedNode(iriIn(context, recordIri(records.prefix, typeOf(label).label, id)));
	const fieldOf = (label: string, field: string): TFieldTerm => {
		const held = typeOf(label).fields.get(field);
		if (held === undefined) throw new Error(`${label} doesn't declare the field ${field}, so its facts don't have an N3 predicate. Declare the field in the type's topology.`);
		return held;
	};
	const objectOf = ({ namedGraph, predicate, object }: TFact): Quad_Object => {
		const { targets } = fieldOf(namedGraph, predicate);
		if (targets.length === 0) return termOf(object);
		if (targets.length > 1)
			throw new Error(
				`the edge ${predicate} of ${namedGraph} reaches ${targets.join(", ")}, so its value ${String(object)} doesn't name one record. Declare one range for the edge.`,
			);
		return individualOf(itemAt(targets, 0), String(object));
	};
	const iriOf = (individual: Term): { label: string; id: string } => {
		const iri = individual.value;
		const named = individual.termType === "NamedNode" && iri.startsWith(namespace) ? recordOfIri(`${records.prefix}:${iri.slice(namespace.length)}`) : undefined;
		const label = named === undefined ? undefined : byLowerLabel.get(named.lowerLabel);
		if (named === undefined || label === undefined) throw new Error(`${iri} isn't the IRI of a record of a persisted type. Name a record as recordIri names it.`);
		return { label, id: named.id };
	};
	return {
		classIri: (label) => typeOf(label).classIri,
		statements: (label, facts) => {
			const { classIri } = typeOf(label);
			const typed = [...new Set(facts.map(({ subject }) => subject))].map((id) => DataFactory.quad(individualOf(label, id), namedNode(RDF.type), classIri));
			return [...typed, ...facts.map((fact) => DataFactory.quad(individualOf(label, fact.subject), fieldOf(label, fact.predicate).iri, objectOf(fact)))];
		},
		patternOf: (subject, predicate) => {
			const { label, id } = iriOf(subject);
			const field = [...typeOf(label).fields].find(([, held]) => held.iri.equals(predicate));
			if (field === undefined) throw new Error(`${label} doesn't declare a field whose IRI is ${predicate.value}. Read a field the type declares.`);
			return { subject: id, predicate: field[0], namedGraph: label };
		},
		objectOf,
		addressOf: (individual) => {
			const { label, id } = iriOf(individual);
			return { persistedAs: label, id };
		},
		individualAt: (address) => {
			const colon = address.indexOf(":");
			if (colon <= 0) throw new Error(`${address} isn't a record's address. Write it as Type:id.`);
			return individualOf(address.slice(0, colon), address.slice(colon + 1));
		},
	};
}
