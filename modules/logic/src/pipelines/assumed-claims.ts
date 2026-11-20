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
import { EVIDENCE_EDGE, isPersisted, type THypermediaTopology } from "@haibun/core/lib/domains/resources.js";
import { OWL, RDF } from "@haibun/core/lib/domains/vocabularies.js";
import { registeredVocabularies } from "@haibun/core/lib/domains/vocabulary-registry.js";
import { ClaimProductsSchema, type TAssumedClaim } from "@haibun/core/lib/records/domains/claim.js";
import { curieOf, type TRecordName } from "@haibun/core/lib/records/domains/unit.js";
import { RULE_SET } from "../domains/reasoning.js";
import { quadsText } from "../derivations/n3.js";
import { instanceChecked, REFUTED_BY, type TClaimScope } from "./claims.js";
import { membershipRefuted, queryBasis } from "./members.js";
import { readerOf } from "./reads.js";
import { explain } from "./reason.js";
import { ASSUMED_CHECK, CLAIM_CHECK, CLAIM_CHECK_IRIS, checkN3, type TClaimCheck, type TField, type TStatementVerdict } from "@haibun/core/lib/steps/domains/contract.js";
import { checksIn } from "./contract-checks.js";
import type { TAssumedClaims } from "@haibun/core/lib/actuality/ports.js";
import type { TProof } from "../domains/reasoning.js";
import { recordPremisesOf } from "../derivations/proof.js";

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
async function consistency(scope: TClaimScope, label: string, written: readonly TRecordName[]): Promise<TAssumedClaims> {
	const test = `the ${label} is consistent with the ontology`;
	const basis = queryBasis(scope.domains);
	const terms = basis.termsOf(scope.records);
	const { facts, truncated } = await factsOf(scope, [label]);
	// Each record written is a member of its type, though it states a field of the type's only in its id.
	const members = written.map((subject) => DataFactory.quad(terms.individualAt(curieOf(subject)), DataFactory.namedNode(RDF.type), terms.classIri(label)));
	const rules = [basis.axioms, basis.closure, ...facts, quadsText(members)].join("\n");
	const { proof } = await explain(scope.reasoner, scope.store, scope.domains, scope.records, {
		ruleSets: [RULE_SET.owlRl],
		rules,
		query: scope.reasoner.rules(RULE_SET.disjointnessQuery),
		closedOver: [],
	});
	const clashing = selected(scope, proof.gives, written);
	const claims = await Promise.all(
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
	return { claims, checks: clashing.size === 0 ? [] : [checkN3(CLAIM_CHECK.consistency, premisesText(terms, proof))] };
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
async function identities(scope: TClaimScope, label: string, written: readonly TRecordName[]): Promise<TAssumedClaims> {
	const inverseFunctional = inverseFunctionalIris(scope);
	const persisted = Object.values(scope.domains).flatMap(({ topology }) => (isPersisted(topology) ? [topology] : []));
	const own = persisted.find(({ persistedAs }) => persistedAs === label);
	const keys = own === undefined ? [] : fieldIris(own).filter((iri) => inverseFunctional.has(iri));
	if (keys.length === 0) return { claims: [], checks: [] };
	const sharing = persisted.filter((topology) => fieldIris(topology).some((iri) => keys.includes(iri))).map(({ persistedAs }) => persistedAs);
	const basis = queryBasis(scope.domains);
	const { facts } = await factsOf(scope, sharing);
	const { proof } = await explain(scope.reasoner, scope.store, scope.domains, scope.records, {
		ruleSets: [RULE_SET.owlRl],
		rules: [basis.axioms, basis.closure, ...facts].join("\n"),
		query: SAME_AS_QUERY,
		closedOver: [],
	});
	const terms = basis.termsOf(scope.records);
	const held = new Set(written.map(curieOf));
	const pairs = proof.gives.flatMap(({ subject, object }) => {
		const [one, other] = [terms.recordAt(subject), terms.recordAt(DataFactory.namedNode(object.value))];
		if (one === undefined || other === undefined || subject.equals(object)) return [];
		const record = { label: one.persistedAs, id: one.id };
		return held.has(curieOf(record)) ? [{ record, same: { label: other.persistedAs, id: other.id } }] : [];
	});
	const claims = await Promise.all(pairs.map(({ record, same }) => claimOf(scope, record, `{${curieOf(same)}}`, `the ${record.label} is the ${same.label} ${same.id}`)));
	return { claims, checks: pairs.length === 0 ? [] : [checkN3(CLAIM_CHECK.identity, premisesText(terms, proof))] };
}

/** The check of `anchor_current` over a stored record (`anchorCurrentCheck`), reading its passages through the edges `quoting`. */
export type TAnchorCheck = (record: TRecordName, quoting: readonly TField[]) => Promise<Pick<TStatementVerdict, "verdict" | "decidedBy"> & { readonly facts: string }>;

/** Returns the claim that each record of `written` that cites passages as evidence of its values quotes their Bodies as they read:
 *  the passages its writer anchored state the digest of the Bodies it read, so a Body edited while the step ran leaves the claim
 *  unproved. A record that doesn't cite a passage doesn't make the claim. */
async function passageClaims(scope: TClaimScope, check: TAnchorCheck, written: readonly TRecordName[]): Promise<TAssumedClaims> {
	const citing = await Promise.all(
		written.map(async (record) => {
			const cited = await readerOf(scope.store).facts({ subject: record.id, predicate: EVIDENCE_EDGE.rel, namedGraph: record.label });
			return cited.length > 0 ? [record] : [];
		}),
	);
	const checked = await Promise.all(
		citing.flat().map(async (subject) => {
			const { verdict, decidedBy, facts } = await check(subject, [{ persistedAs: subject.label, key: EVIDENCE_EDGE.rel }]);
			if (verdict === VERDICT.contradiction) throw new Error(`the check of the ${subject.label} ${subject.id}'s passages doesn't state a claim's verdict`);
			const claim: TAssumedClaim = { subject, test: `the ${subject.label}'s passages quote their Bodies as they read`, verdict, proof: decidedBy };
			return { claim, check: checkN3(ASSUMED_CHECK, facts) };
		}),
	);
	return { claims: checked.map(({ claim }) => claim), checks: checked.map(({ check: read }) => read) };
}

/** Returns the claims about the records `written` names: each record's consistency with the ontology, each record of the store it
 *  is the same individual as, and, for a record that cites passages, that its passages quote their Bodies as they read. */
export async function assumedClaims(scope: TClaimScope, written: readonly TRecordName[], check: TAnchorCheck): Promise<TAssumedClaims> {
	const byType = Map.groupBy(written, ({ label }) => label);
	const [typed, passages] = await Promise.all([
		Promise.all([...byType].flatMap(([label, records]) => [consistency(scope, label, records), identities(scope, label, records)])),
		passageClaims(scope, check, written),
	]);
	const claimed = [...typed, passages];
	return { claims: claimed.flatMap(({ claims }) => claims), checks: claimed.flatMap(({ checks }) => checks) };
}

/** Returns the facts of records a claim's proof read, as N3, by the records `terms` names, which the claim's check holds. */
const premisesText = (terms: ReturnType<ReturnType<typeof queryBasis>["termsOf"]>, proof: TProof): string =>
	quadsText(recordPremisesOf(proof, (subject) => terms.recordAt(DataFactory.namedNode(subject.value)) !== undefined));

/** The query of each check of a claim proved under the ontology, which a why view runs again over the premises the check holds. */
const CLAIM_QUERIES: Record<TClaimCheck, (scope: TClaimScope) => string> = {
	[CLAIM_CHECK.identity]: () => SAME_AS_QUERY,
	[CLAIM_CHECK.consistency]: (scope) => scope.reasoner.rules(RULE_SET.disjointnessQuery),
};

/** Returns EYE's proof of each claim check of `checks`, the N3 an assumed step's record holds: the check's query proved again under
 *  the rules of OWL 2 RL from the ontology and the premises the check holds, so the why view frames what the claim's proof read. */
export function claimProofs(scope: TClaimScope, checks: string): Promise<TProof[]> {
	const basis = queryBasis(scope.domains);
	return Promise.all(
		checksIn(checks).flatMap(({ check, facts }) => {
			const claim = CLAIM_CHECK_IRIS.get(check);
			if (claim === undefined) return [];
			const reasoning = { ruleSets: [RULE_SET.owlRl], rules: [basis.axioms, basis.closure, facts].join("\n"), query: CLAIM_QUERIES[claim](scope), closedOver: [] };
			return [explain(scope.reasoner, scope.store, scope.domains, scope.records, reasoning).then(({ proof }) => proof)];
		}),
	);
}
