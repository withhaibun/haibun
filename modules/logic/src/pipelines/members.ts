/**
 * Returns the members a class expression entails over the store: the ontology as OWL 2, the rules of OWL 2 RL, the rules of
 * the expression, and the records of each type an expression's name can reach, read under the caller's authority as open
 * facts. A member the records don't entail may still exist, so the members are the entailed ones only.
 */
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { buildConcernCatalog, getJsonLdContext } from "@haibun/core/lib/domains/hypermedia.js";
import { CLASS_LABEL, PROPERTY_LABEL, isPersisted, type TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import type { TIndividualAddress } from "@haibun/core/lib/domains/typed-links.js";
import { ancestorsWith, ontologyToQuads } from "@haibun/core/lib/records/derivations/ontology.js";
import { iriIn, ontologyOwl } from "@haibun/core/lib/records/derivations/owl.js";
import { ONTOLOGY_FIELD } from "@haibun/core/lib/records/domains/ontology.js";
import { OWL_RL_RULES, QUERY_NAMESPACE } from "../domains/reasoning.js";
import { expressionRules, namesOf, parseClassExpression } from "../derivations/class-expression.js";
import { recordTerms } from "../derivations/n3.js";
import type { TReasoner } from "../ports.js";
import { readerOf } from "./reads.js";
import { reason } from "./reason.js";

/** Returns the addresses of the records a class expression entails as its members. */
export async function entailedMembers(reasoner: TReasoner, store: IQuadStore, domains: Record<string, TRegisteredDomain>, text: string): Promise<TIndividualAddress[]> {
	const expression = parseClassExpression(text);
	const context = getJsonLdContext(domains)["@context"];
	const ontology = ontologyToQuads(domains);
	const terms = recordTerms(buildConcernCatalog(domains), context);
	const stated = (label: string, field: string) => ontology.quads.filter((q) => q.namedGraph === label && q.predicate === field);
	const propertyUri = new Map(stated(PROPERTY_LABEL, ONTOLOGY_FIELD.uri).map((q) => [q.subject, String(q.object)]));
	const propertyIri = (name: string): string => {
		const uri = propertyUri.get(name);
		if (uri === undefined) throw new Error(`the class expression names the property ${name}, which the ontology doesn't hold. Name a link relation that \`show ontology\` lists.`);
		return iriIn(context, uri);
	};
	const { classes, properties } = namesOf(expression);
	const parents = [...stated(CLASS_LABEL, ONTOLOGY_FIELD.classIri), ...stated(CLASS_LABEL, ONTOLOGY_FIELD.subClassOf)];
	const supers = new Map([...Map.groupBy(parents, (q) => q.subject)].map(([subject, held]) => [subject, held.map((q) => String(q.object))]));
	const connected = new Set(
		properties.flatMap((name) =>
			[ONTOLOGY_FIELD.domain, ONTOLOGY_FIELD.range].flatMap((field) =>
				stated(PROPERTY_LABEL, field)
					.filter((q) => q.subject === name)
					.map((q) => String(q.object)),
			),
		),
	);
	const named = new Set(classes.map((name) => iriIn(context, name)));
	const labels = Object.values(domains).flatMap(({ topology }) => (isPersisted(topology) ? [topology.persistedAs] : []));
	const read = labels.filter((label) => connected.has(label) || [...ancestorsWith(label, supers)].some((cls) => named.has(iriIn(context, cls))));
	const reader = readerOf(store);
	const facts = await Promise.all(read.map(async (label) => terms.statements(label, await reader.facts({ namedGraph: label }))));
	const { rules, query } = expressionRules(expression, QUERY_NAMESPACE, { classIri: (name) => iriIn(context, name), propertyIri, individualIri: terms.individualAt });
	const owl = ontologyOwl(ontology, context);
	const derived = await reason(reasoner, store, domains, { rules: [owl, OWL_RL_RULES, rules, ...facts].join("\n"), query, closedOver: [] });
	return [...new Map(derived.map(({ subject }) => [subject, terms.addressOf(subject)])).values()];
}
