/**
 * Returns the members a class expression entails over the store, through the reasoner: the ontology as OWL 2, the rules of
 * OWL 2 RL, the rules of the expression, and the records of each type an expression's name can reach, read under the
 * caller's authority as open facts. A member the records don't entail may still exist, so the members are the entailed ones only.
 */
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { buildConcernCatalog, getJsonLdContext } from "@haibun/core/lib/domains/hypermedia.js";
import { CLASS_LABEL, PROPERTY_LABEL, isPersisted, type TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import type { TIndividualAddress } from "@haibun/core/lib/domains/typed-links.js";
import { ancestorsWith, ontologyToQuads } from "@haibun/core/lib/records/derivations/ontology.js";
import { iriIn, ontologyOwl } from "@haibun/core/lib/records/derivations/owl.js";
import { ONTOLOGY_FIELD } from "@haibun/core/lib/records/domains/ontology.js";
import { OWL_RL_RULES, QUERY_NAMESPACE } from "../domains/reasoning.js";
import {
	dlOf,
	expressionRules,
	nameRefusal,
	namesOf,
	parseClassExpression,
	readingOf,
	type TClassExpression,
	type TExpressionIris,
	type TVocabulary,
} from "../derivations/class-expression.js";
import { recordTerms, type TRecordTerms } from "../derivations/n3.js";
import type { TReasoner } from "../ports.js";
import { readerOf } from "./reads.js";
import { reason } from "./reason.js";

/** What a query over the declarations reads: the IRIs of its names, the records' N3 terms, the ontology as OWL 2 with the
 *  rules of OWL 2 RL, the vocabulary its names are checked against, and the types each class subsumes. */
type TQueryBasis = { iris: TExpressionIris; terms: TRecordTerms; axioms: string; vocabulary: TVocabulary; typesReached: (expression: TClassExpression) => string[] };

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
	const terms = recordTerms(buildConcernCatalog(domains), context);
	const stated = (label: string, field: string) => ontology.quads.filter((q) => q.namedGraph === label && q.predicate === field);
	const declared = (field: string, name: string): string[] =>
		stated(PROPERTY_LABEL, field)
			.filter((q) => q.subject === name)
			.map((q) => String(q.object));
	const propertyUri = new Map(stated(PROPERTY_LABEL, ONTOLOGY_FIELD.uri).map((q) => [q.subject, String(q.object)]));
	const propertyIri = (name: string): string => {
		const uri = propertyUri.get(name);
		if (uri === undefined) throw new Error(`the class expression names the property ${name}, which the ontology doesn't hold. Name a link relation that \`show ontology\` lists.`);
		return iriIn(context, uri);
	};
	const parents = [...stated(CLASS_LABEL, ONTOLOGY_FIELD.classIri), ...stated(CLASS_LABEL, ONTOLOGY_FIELD.subClassOf)];
	const supers = new Map([...Map.groupBy(parents, (q) => q.subject)].map(([subject, held]) => [subject, held.map((q) => String(q.object))]));
	const classes = [...new Set([...stated(CLASS_LABEL, ONTOLOGY_FIELD.name).map(({ subject }) => subject), ...parents.map((q) => String(q.object))])];
	const vocabulary: TVocabulary = {
		classes,
		properties: [...propertyUri.keys()].map((name) => ({ name, domain: declared(ONTOLOGY_FIELD.domain, name), range: declared(ONTOLOGY_FIELD.range, name) })),
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
		iris: { classIri: (name) => iriIn(context, name), propertyIri, individualIri: terms.individualAt },
		terms,
		axioms: [ontologyOwl(ontology, context), OWL_RL_RULES].join("\n"),
		vocabulary,
		typesReached,
	};
}

/** Returns an expression's parts, refusing one whose names the vocabulary doesn't hold or whose restriction reads against its
 *  property's direction. */
export function checkedExpression(text: string, basis: TQueryBasis): TClassExpression {
	const expression = parseClassExpression(text);
	const refusal = nameRefusal(expression, basis.vocabulary);
	if (refusal !== undefined) throw new Error(`the class expression \`${text}\`: ${refusal}`);
	return expression;
}

/** Returns a class expression in DL notation and as its plain-English reading, refusing one the vocabulary doesn't hold. */
export function expressionReading(text: string, domains: Record<string, TRegisteredDomain>): string {
	const expression = checkedExpression(text, queryBasis(domains));
	return `${dlOf(expression)} · ${readingOf(expression)}`;
}

/** Returns the addresses of the records a class expression entails as its members. */
export async function entailedMembers(reasoner: TReasoner, store: IQuadStore, domains: Record<string, TRegisteredDomain>, text: string): Promise<TIndividualAddress[]> {
	const basis = queryBasis(domains);
	const expression = checkedExpression(text, basis);
	const reader = readerOf(store);
	const facts = await Promise.all(basis.typesReached(expression).map(async (label) => basis.terms.statements(label, await reader.facts({ namedGraph: label }))));
	const { rules, query } = expressionRules(expression, QUERY_NAMESPACE, basis.iris);
	const derived = await reason(reasoner, store, domains, { rules: [basis.axioms, rules, ...facts].join("\n"), query, closedOver: [] });
	return [...new Map(derived.map(({ subject }) => [subject, basis.terms.addressOf(subject)])).values()];
}
