/**
 * The claims over class expressions, proved through the reasoner: the members an expression entails, and whether one
 * expression subsumes another. Each reads the ontology as OWL 2 and the rules of OWL 2 RL. A query of members also reads the
 * records of each type an expression's name can reach, under the caller's authority, as open facts, so a member the records
 * don't entail may still exist. A subsumption reads the ontology alone: it holds where a member that stands for any member
 * of the first expression is entailed a member of the second.
 */
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { buildConcernCatalog, getJsonLdContext } from "@haibun/core/lib/domains/hypermedia.js";
import { CLASS_LABEL, PROPERTY_LABEL, isPersisted, type TRecordNamespace, type TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import type { TEntailed } from "@haibun/core/lib/actuality/ports.js";
import type { TIndividualAddress } from "@haibun/core/lib/domains/typed-links.js";
import { ancestorsWith, ontologyToQuads } from "@haibun/core/lib/records/derivations/ontology.js";
import { iriIn, nameIn, ontologyOwl } from "@haibun/core/lib/records/derivations/owl.js";
import { ONTOLOGY_FIELD } from "@haibun/core/lib/records/domains/ontology.js";
import { DL_SYMBOL, type TClaimWitness } from "@haibun/core/lib/records/domains/axioms.js";
import { manchesterName } from "@haibun/core/lib/records/derivations/axioms.js";
import { QUERY_NAMESPACE, REASONING_READ_CEILING, RULE_SET } from "../domains/reasoning.js";
import { DataFactory } from "n3";
import type { NamedNode, Term } from "@rdfjs/types";
import { dlOf, nameRefusal, namesOf, parseClassExpression, readingOf, resolvedExpression, type TVocabulary } from "@haibun/core/lib/records/derivations/class-expression.js";
import type { TClassExpression } from "@haibun/core/lib/records/domains/class-expression.js";
import { expressionRules, frozenMembers, type TExpressionIris } from "../derivations/class-expression.js";
import { patternText, quadsText, recordTerms, type TRecordTerms } from "../derivations/n3.js";
import type { TReasoner } from "../ports.js";
import { extractedBy, functionalAxiom } from "../derivations/proof.js";
import { readerOf } from "./reads.js";
import { explain, reason } from "./reason.js";

/** The rule sets a query over class expressions reads: the rules of OWL 2 RL, and the class axioms of the standard vocabularies. */
const CLASS_RULE_SETS = [RULE_SET.owlRl, RULE_SET.standardAxioms];

/** What a query over the declarations reads: the IRIs of its classes and properties, the records' N3 terms under the records'
 *  namespace, the ontology as OWL 2, the vocabulary its names are checked against, and the types
 *  each class subsumes. */
type TQueryBasis = {
	iris: Omit<TExpressionIris, "individualIri">;
	termsOf: (records: TRecordNamespace) => TRecordTerms;
	axioms: string;
	/** The name of a class's or a property's IRI in the served context. */
	nameOf: (iri: string) => string;
	vocabulary: TVocabulary;
	typesReached: (expression: TClassExpression) => string[];
};

/** The IRIs of a query's names, with each record named by its IRI under the records' namespace. */
const irisOf = (basis: TQueryBasis, terms: TRecordTerms): TExpressionIris => ({ ...basis.iris, individualIri: terms.individualAt });

/** What a query read, by the declarations it was derived from, with the count of those declarations. */
const basisFor = new WeakMap<Record<string, TRegisteredDomain>, { size: number; basis: TQueryBasis }>();

/** Returns what a query over the declarations reads, derived again where a declaration was added since. */
export function queryBasis(domains: Record<string, TRegisteredDomain>): TQueryBasis {
	const size = Object.keys(domains).length;
	const held = basisFor.get(domains);
	if (held !== undefined && held.size === size) return held.basis;
	const basis = derivedBasis(domains);
	basisFor.set(domains, { size, basis });
	return basis;
}

/** Derives what a query over the declarations reads. */
function derivedBasis(domains: Record<string, TRegisteredDomain>): TQueryBasis {
	const context = getJsonLdContext(domains)["@context"];
	const ontology = ontologyToQuads(domains);
	const catalog = buildConcernCatalog(domains);
	const stated = (label: string, field: string) => ontology.quads.filter((q) => q.namedGraph === label && q.predicate === field);
	const declared = (field: string, name: string): string[] =>
		stated(PROPERTY_LABEL, field)
			.filter((q) => q.subject === name)
			.map((q) => String(q.object));
	const propertyUri = new Map(stated(PROPERTY_LABEL, ONTOLOGY_FIELD.uri).map((q) => [q.subject, String(q.object)]));
	const propertyIri = (name: string) => {
		const uri = propertyUri.get(name);
		if (uri === undefined) throw new Error(`the class expression names the property ${name}, which the ontology doesn't hold. Name a link relation that \`show ontology\` lists.`);
		return DataFactory.namedNode(iriIn(context, uri));
	};
	const parents = [...stated(CLASS_LABEL, ONTOLOGY_FIELD.classIri), ...stated(CLASS_LABEL, ONTOLOGY_FIELD.subClassOf)];
	const supers = new Map([...Map.groupBy(parents, (q) => q.subject)].map(([subject, held]) => [subject, held.map((q) => String(q.object))]));
	const classes = [...new Set([...stated(CLASS_LABEL, ONTOLOGY_FIELD.name).map(({ subject }) => subject), ...parents.map((q) => String(q.object))])];
	const fieldOf = new Map(stated(PROPERTY_LABEL, ONTOLOGY_FIELD.field).map((q) => [q.subject, String(q.object)]));
	const vocabulary: TVocabulary = {
		classes,
		properties: [...propertyUri.keys()].map((name) => {
			const field = fieldOf.get(name);
			return { name, domain: declared(ONTOLOGY_FIELD.domain, name), range: declared(ONTOLOGY_FIELD.range, name), ...(field === undefined ? {} : { field }) };
		}),
		ancestors: (cls) => ancestorsWith(cls, supers),
	};
	const labels = Object.values(domains).flatMap(({ topology }) => (isPersisted(topology) ? [topology.persistedAs] : []));
	const typesReached = (expression: TClassExpression): string[] => {
		const { classes: named, properties } = namesOf(expression);
		const iris = new Set(named.map((name) => iriIn(context, name)));
		const connected = new Set(properties.flatMap((name) => [...declared(ONTOLOGY_FIELD.domain, name), ...declared(ONTOLOGY_FIELD.range, name)]));
		return labels.filter((label) => connected.has(label) || [...ancestorsWith(label, supers)].some((cls) => iris.has(iriIn(context, cls))));
	};
	return {
		iris: { classIri: (name) => DataFactory.namedNode(iriIn(context, name)), propertyIri },
		termsOf: (records) => recordTerms(catalog, getJsonLdContext(domains, undefined, records)["@context"], records),
		axioms: ontologyOwl(ontology, context),
		nameOf: (iri) => nameIn(context, iri),
		vocabulary,
		typesReached,
	};
}

/** Returns an expression's parts with each property resolved to the vocabulary's, refusing one whose names the vocabulary
 *  doesn't hold or whose restriction reads against its property's direction. */
export function checkedExpression(text: string, basis: TQueryBasis): TClassExpression {
	const expression = parseClassExpression(text);
	const refusal = nameRefusal(expression, basis.vocabulary);
	if (refusal !== undefined) throw new Error(`the class expression \`${text}\`: ${refusal}`);
	const resolved = resolvedExpression(expression, basis.vocabulary);
	if ("refused" in resolved) throw new Error(`the class expression \`${text}\`: ${resolved.refused}`);
	return resolved;
}

/** Returns the expressions that complete `text`: its last word replaced by each class or property name of the ontology that
 *  begins with that word, as a reader typing a name is offered the names that continue it. */
export function expressionCompletions(text: string, domains: Record<string, TRegisteredDomain>): string[] {
	const { vocabulary } = queryBasis(domains);
	const last = text.split(/[\s()]+/).at(-1);
	if (last === undefined || last.length === 0) return [];
	// A field is offered by its name within a class the text names; a relation and a class by their own names.
	const named = vocabulary.classes.filter((cls) => text.split(/[\s()]+/).includes(cls));
	const fields = vocabulary.properties.flatMap(({ field, domain }) => (field !== undefined && domain.some((cls) => named.includes(cls)) ? [field] : []));
	const relations = vocabulary.properties.flatMap(({ name, field }) => (field === undefined ? [name] : []));
	const names = [...vocabulary.classes, ...relations, ...fields];
	const head = text.slice(0, text.length - last.length);
	return [...new Set(names)].filter((name) => name.startsWith(last) && name !== last).map((name) => `${head}${name}`);
}

/** Returns a class expression in DL notation and as its plain-English reading, refusing one the vocabulary doesn't hold. */
export function expressionReading(text: string, domains: Record<string, TRegisteredDomain>): string {
	const expression = checkedExpression(text, queryBasis(domains));
	return `${dlOf(expression)} · ${readingOf(expression)}`;
}

/** The members as a counted list: a count of what the reads entail, which is a floor where a read stopped at its ceiling. */
export const countedMembers = ({ members, truncated }: TEntailed) => ({ members, total: members.length, saturated: truncated.length > 0 });

/** Why an unproved membership stays unknown beyond the open world: the types whose reads stopped at the reasoning's ceiling. */
export const truncationOf = ({ truncated }: TEntailed): string =>
	truncated.length === 0 ? "" : ` The reads of ${truncated.join(", ")} stopped at ${REASONING_READ_CEILING} records, and the records after them weren't read.`;

/** Returns the addresses of the records a class expression entails as its members, and the types whose reads stopped at the
 *  reasoning's ceiling. */
export async function entailedMembers(
	reasoner: TReasoner,
	store: IQuadStore,
	domains: Record<string, TRegisteredDomain>,
	records: TRecordNamespace,
	text: string,
): Promise<TEntailed> {
	const basis = queryBasis(domains);
	const terms = basis.termsOf(records);
	const expression = checkedExpression(text, basis);
	const reader = readerOf(store);
	const reads = await Promise.all(basis.typesReached(expression).map(async (label) => ({ label, ...(await reader.records(label)) })));
	const { rules, query } = expressionRules(expression, QUERY_NAMESPACE, irisOf(basis, terms));
	const facts = reads.map(({ label, facts: read }) => quadsText(terms.statements(label, read)));
	const derived = await reason(reasoner, store, domains, records, { ruleSets: CLASS_RULE_SETS, rules: [basis.axioms, rules, ...facts].join("\n"), query, closedOver: [] });
	const members = [...new Map(derived.map(({ subject }) => [subject, terms.addressOf(subject)])).values()];
	return { members, truncated: reads.flatMap(({ label, truncated }) => (truncated ? [label] : [])) };
}

/** The individual that stands for any member of an expression in a subsumption. */
const FROZEN = DataFactory.namedNode(`${QUERY_NAMESPACE}member`);

/** An individual's address as a claim names it: its type and its id. */
export const addressText = ({ persistedAs, id }: TIndividualAddress): string => `${persistedAs}:${id}`;

/** Returns the witness of a subsumption the ontology doesn't entail, as data and as text: the subsumption in DL notation, and the
 *  entailed members of `sub` that `sup` doesn't hold. */
export async function subsumptionWitness(
	reasoner: TReasoner,
	store: IQuadStore,
	domains: Record<string, TRegisteredDomain>,
	records: TRecordNamespace,
	sub: string,
	sup: string,
): Promise<{ exceeding: string; witness: TClaimWitness }> {
	const basis = queryBasis(domains);
	const subsumption = `${dlOf(checkedExpression(sub, basis))} ${DL_SYMBOL.subsumedBy} ${dlOf(checkedExpression(sup, basis))}`;
	const held = new Set((await entailedMembers(reasoner, store, domains, records, sup)).members.map(addressText));
	const members = (await entailedMembers(reasoner, store, domains, records, sub)).members.filter((member) => !held.has(addressText(member)));
	const exceeding = members.length === 0 ? "the records don't hold a member that exceeds it" : `the witness that exceeds it is ${members.map(addressText).join(", ")}`;
	return { exceeding, witness: { subsumption, sub, sup, members } };
}

/** Returns whether the ontology entails that every member of `sub` is a member of `sup`. */
export async function subsumes(
	reasoner: TReasoner,
	store: IQuadStore,
	domains: Record<string, TRegisteredDomain>,
	records: TRecordNamespace,
	sub: string,
	sup: string,
): Promise<boolean> {
	const basis = queryBasis(domains);
	const iris = irisOf(basis, basis.termsOf(records));
	const [narrower, wider] = [checkedExpression(sub, basis), checkedExpression(sup, basis)];
	const { rules, query } = expressionRules(wider, QUERY_NAMESPACE, iris);
	for (const facts of frozenMembers(narrower, FROZEN, QUERY_NAMESPACE, iris)) {
		const derived = await reason(reasoner, store, domains, records, {
			ruleSets: CLASS_RULE_SETS,
			rules: [basis.axioms, rules, ...facts.map(patternText)].join("\n"),
			query,
			closedOver: [],
		});
		if (!derived.some(({ subject }) => subject.equals(FROZEN))) return false;
	}
	return true;
}

/** Returns the axioms, in OWL 2 functional syntax, by which K entails that `subject` isn't a member of `expression`: where each way
 *  of being a member makes it a member of two classes an axiom states disjoint (the rule cax-dw of OWL 2 RL), the axioms, records
 *  of `labels` and standard axioms the reasoner's proof of each read, apart from the membership supposed. Returns undefined where a
 *  way of being a member doesn't contradict a disjointness, so K doesn't entail the membership's contradiction. */
async function disjointnessMet(
	reasoner: TReasoner,
	store: IQuadStore,
	domains: Record<string, TRegisteredDomain>,
	records: TRecordNamespace,
	labels: readonly string[],
	subject: NamedNode,
	expression: TClassExpression,
): Promise<string[] | undefined> {
	const basis = queryBasis(domains);
	const terms = basis.termsOf(records);
	const reader = readerOf(store);
	const facts = await Promise.all(labels.map(async (label) => quadsText(terms.statements(label, (await reader.records(label)).facts))));
	const nameOf = (term: Term): string => {
		if (term.termType === "Literal") return JSON.stringify(term.value);
		const address = terms.recordAt(term);
		return manchesterName(address === undefined ? basis.nameOf(term.value) : addressText(address));
	};
	const query = reasoner.rules(RULE_SET.disjointnessQuery);
	const met = new Set<string>();
	for (const supposed of frozenMembers(expression, subject, QUERY_NAMESPACE, irisOf(basis, terms))) {
		const supposition = supposed.map(patternText);
		const rules = [basis.axioms, ...facts, ...supposition].join("\n");
		const { proof } = await explain(reasoner, store, domains, records, { ruleSets: CLASS_RULE_SETS, rules, query, closedOver: [] });
		if (proof.gives.length === 0) return undefined;
		for (const read of extractedBy(proof)) if (!supposition.includes(patternText(read))) met.add(functionalAxiom(read, nameOf));
	}
	return [...met].sort();
}

/** Returns the axioms by which K entails that the record at `address` isn't a member of `text`, or undefined where it doesn't. */
export function membershipRefuted(
	reasoner: TReasoner,
	store: IQuadStore,
	domains: Record<string, TRegisteredDomain>,
	records: TRecordNamespace,
	address: TIndividualAddress,
	text: string,
): Promise<string[] | undefined> {
	const basis = queryBasis(domains);
	const individual = basis.termsOf(records).individualAt(addressText(address));
	return disjointnessMet(reasoner, store, domains, records, [address.persistedAs], individual, checkedExpression(text, basis));
}

/** Returns the axioms by which the ontology entails that a member of `sub` isn't a member of `sup`: an individual that stands for any
 *  member of both is a member of two disjoint classes. Undefined where it doesn't. */
export function disjointExpressions(
	reasoner: TReasoner,
	store: IQuadStore,
	domains: Record<string, TRegisteredDomain>,
	records: TRecordNamespace,
	sub: string,
	sup: string,
): Promise<string[] | undefined> {
	const basis = queryBasis(domains);
	return disjointnessMet(reasoner, store, domains, records, [], FROZEN, { and: [checkedExpression(sub, basis), checkedExpression(sup, basis)] });
}
