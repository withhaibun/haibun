/**
 * The claims about the records a step whose products are assumed wrote, checked against the ontology under the rules of OWL 2 RL
 * one type at a time, so a step that writes many records of a type reasons over the type once. A record whose facts make it a
 * member of two classes the ontology states disjoint is refuted with the axioms of its contradiction, and each other record holds.
 * A record that shares a value of an inverse functional property with a record the store holds is that record, with the proof of
 * the value they share.
 */
import { DataFactory } from "n3";
import type { Quad } from "@rdfjs/types";
import { VERDICT } from "@haibun/core/lib/domains/protocol.js";
import { declaredFieldIri } from "@haibun/core/lib/domains/hypermedia.js";
import { isPersisted, type THypermediaTopology } from "@haibun/core/lib/domains/resources.js";
import { OWL, RDF } from "@haibun/core/lib/domains/vocabularies.js";
import { registeredVocabularies } from "@haibun/core/lib/domains/vocabulary-registry.js";
import { ClaimProductsSchema, type TAssumedClaim } from "@haibun/core/lib/records/domains/claim.js";
import { curieOf, type TRecordName } from "@haibun/core/lib/records/domains/unit.js";
import { RULE_SET } from "../domains/reasoning.js";
import { quadsText } from "../derivations/n3.js";
import { instanceChecked, REFUTED_BY, type TClaimScope } from "./claims.js";
import { membershipRefuted, queryBasis } from "./members.js";
import { readerOf } from "./reads.js";
import { reason } from "./reason.js";

/** The query that selects each pair of individuals the rules entail are one individual. */
const SAME_AS_QUERY = `{ ?x <${OWL.sameAs}> ?y } => { ?x <${OWL.sameAs}> ?y } .`;

/** Returns what an instance check of `expression` concludes of the record `subject` names, as an assumed claim of `test`. */
async function claimOf(scope: TClaimScope, subject: TRecordName, expression: string, test: string): Promise<TAssumedClaim> {
	const { verdict, proof } = ClaimProductsSchema.parse((await instanceChecked(scope, { persistedAs: subject.label, id: subject.id }, expression)).products).claim;
	return { subject, test, verdict, proof };
}

/** Returns the facts of the records of each of `labels`, as the records' terms state them, and the types whose reads stopped at the
 *  reasoning's ceiling. */
async function factsOf(scope: TClaimScope, labels: readonly string[]): Promise<{ facts: string[]; truncated: string[] }> {
	const terms = queryBasis(scope.domains).termsOf(scope.records);
	const reads = await Promise.all(labels.map(async (label) => ({ label, ...(await readerOf(scope.store).records(label)) })));
	return { facts: reads.map(({ label, facts }) => quadsText(terms.statements(label, facts))), truncated: reads.flatMap(({ label, truncated }) => (truncated ? [label] : [])) };
}

/** Returns the records of `written` the query selects as subjects, by their curies. */
function selected(scope: TClaimScope, derived: readonly Quad[], written: readonly TRecordName[]): Set<string> {
	const terms = queryBasis(scope.domains).termsOf(scope.records);
	const held = new Set(written.map(curieOf));
	return new Set(
		derived.flatMap(({ subject }) => {
			const record = terms.recordAt(subject);
			const curie = record === undefined ? undefined : curieOf({ label: record.persistedAs, id: record.id });
			return curie !== undefined && held.has(curie) ? [curie] : [];
		}),
	);
}

/** Returns the claim that each record of `written`, all of the type `label`, is consistent with the ontology: refuted where the
 *  rules entail it a member of two disjoint classes, unknown where the read of its type stopped at the reasoning's ceiling, and
 *  holds otherwise. */
async function consistency(scope: TClaimScope, label: string, written: readonly TRecordName[]): Promise<TAssumedClaim[]> {
	const test = `the ${label} is consistent with the ontology`;
	const basis = queryBasis(scope.domains);
	const terms = basis.termsOf(scope.records);
	const { facts, truncated } = await factsOf(scope, [label]);
	// Each record written is a member of its type, though it states a field of the type's only in its id.
	const members = written.map((subject) => DataFactory.quad(terms.individualAt(curieOf(subject)), DataFactory.namedNode(RDF.type), terms.classIri(label)));
	const rules = [basis.axioms, basis.closure, ...facts, quadsText(members)].join("\n");
	const derived = await reason(scope.reasoner, scope.store, scope.domains, scope.records, {
		ruleSets: [RULE_SET.owlRl],
		rules,
		query: scope.reasoner.rules(RULE_SET.disjointnessQuery),
		closedOver: [],
	});
	const clashing = selected(scope, derived, written);
	return Promise.all(
		written.map(async (subject): Promise<TAssumedClaim> => {
			if (clashing.has(curieOf(subject))) {
				const refuting = await membershipRefuted(scope.reasoner, scope.store, scope.domains, scope.records, { persistedAs: label, id: subject.id }, label);
				if (refuting === undefined)
					throw new Error(
						`the rules entail the ${label} ${subject.id} a member of two disjoint classes, and its refutation doesn't read the disjointness. Check the disjointness query.`,
					);
				return { subject, test, verdict: VERDICT.refuted, proof: `${REFUTED_BY} ${refuting.axioms.join(", ")}` };
			}
			if (truncated.length > 0)
				return { subject, test, verdict: VERDICT.unknown, proof: `the reasoner read the ${label} records up to its ceiling, so a contradiction among the others is open` };
			return {
				subject,
				test,
				verdict: VERDICT.proved,
				proof: `the reasoner doesn't entail the ${label} a member of two disjoint classes under the rules of OWL 2 RL from the ontology and the ${label} records it read`,
			};
		}),
	);
}

/** Returns the IRI of each field of a type. */
const fieldIris = (topology: THypermediaTopology): string[] =>
	[...Object.keys(topology.properties), ...Object.keys(topology.edges === undefined ? {} : topology.edges)].map((field) => declaredFieldIri(topology, field));

/** Returns the IRIs of the inverse functional properties: each field a type's key names as one its records don't share, and each
 *  property a registered vocabulary states inverse functional. */
function inverseFunctionalIris(scope: TClaimScope): Set<string> {
	const keyed = Object.values(scope.domains).flatMap(({ topology }) =>
		isPersisted(topology)
			? (topology.keys === undefined ? [] : topology.keys).flatMap((key) => ("inverseFunctional" in key ? [declaredFieldIri(topology, key.inverseFunctional)] : []))
			: [],
	);
	return new Set([...keyed, ...registeredVocabularies().flatMap(({ inverseFunctional }) => inverseFunctional)]);
}

/** Returns the claim that a record of `written`, all of the type `label`, is each record of the store the rules entail is the same
 *  individual through an inverse functional property, read from each type that declares one of the type's. Returns an empty list
 *  for a type that doesn't declare such a property. */
async function identities(scope: TClaimScope, label: string, written: readonly TRecordName[]): Promise<TAssumedClaim[]> {
	const inverseFunctional = inverseFunctionalIris(scope);
	const persisted = Object.values(scope.domains).flatMap(({ topology }) => (isPersisted(topology) ? [topology] : []));
	const own = persisted.find(({ persistedAs }) => persistedAs === label);
	const keys = own === undefined ? [] : fieldIris(own).filter((iri) => inverseFunctional.has(iri));
	if (keys.length === 0) return [];
	const sharing = persisted.filter((topology) => fieldIris(topology).some((iri) => keys.includes(iri))).map(({ persistedAs }) => persistedAs);
	const basis = queryBasis(scope.domains);
	const { facts } = await factsOf(scope, sharing);
	const derived = await reason(scope.reasoner, scope.store, scope.domains, scope.records, {
		ruleSets: [RULE_SET.owlRl],
		rules: [basis.axioms, basis.closure, ...facts].join("\n"),
		query: SAME_AS_QUERY,
		closedOver: [],
	});
	const terms = basis.termsOf(scope.records);
	const held = new Set(written.map(curieOf));
	const pairs = derived.flatMap(({ subject, object }) => {
		const [one, other] = [terms.recordAt(subject), terms.recordAt(DataFactory.namedNode(object.value))];
		if (one === undefined || other === undefined || subject.equals(object)) return [];
		const record = { label: one.persistedAs, id: one.id };
		return held.has(curieOf(record)) ? [{ record, same: { label: other.persistedAs, id: other.id } }] : [];
	});
	return Promise.all(pairs.map(({ record, same }) => claimOf(scope, record, `{${curieOf(same)}}`, `the ${record.label} is the ${same.label} ${same.id}`)));
}

/** Returns the claims about the records `written` names: each record's consistency with the ontology, and each record of the store
 *  it is the same individual as. */
export async function assumedClaims(scope: TClaimScope, written: readonly TRecordName[]): Promise<TAssumedClaim[]> {
	const byType = Map.groupBy(written, ({ label }) => label);
	const claims = await Promise.all([...byType].map(async ([label, records]) => [...(await consistency(scope, label, records)), ...(await identities(scope, label, records))]));
	return claims.flat();
}
