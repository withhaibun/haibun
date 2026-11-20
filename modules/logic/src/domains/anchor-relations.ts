/**
 * Whether an anchor quotes its Body as the Body reads now. An anchor states the digest of the Body it quoted (`sourceDigest`), and
 * the Body states the digest of its forms (`digest`): the anchor is current where the two are one, and stale where the Body changed
 * after the anchor quoted it. A record that targets or cites anchors, such as a grant that targets the passage it approved or an
 * extracted record that cites the passages of its values, quotes as its Bodies read where each of its anchors is current, so a
 * contract and a claim read an edit made after an approval or an extraction from one relation.
 */
import { edge, holds, parameter, RELATION_NAMESPACE, type TContractChecking, type TField, type TRelation } from "@haibun/core/lib/steps/domains/contract.js";
import { LOG } from "@haibun/core/lib/domains/vocabularies.js";
import { declaredFieldIri, iriIn, namespacesOfType } from "@haibun/core/lib/domains/hypermedia.js";
import { bodyDomainDefinition, specificResourceDomainDefinition } from "@haibun/core/lib/domains/resource-domains.js";
import { BODY_DIGEST, commentDomainDefinition, isPersisted, LinkRelations, SOURCE_DIGEST, type TDomainDefinition } from "@haibun/core/lib/domains/resources.js";

/** The stored type a definition declares, whose fields an anchor's relation reads. */
function storedTopology(definition: TDomainDefinition) {
	const { topology } = definition;
	if (!isPersisted(topology)) throw new Error(`${definition.selectors.join(", ")} doesn't declare a stored type, and an anchor's relation reads its fields`);
	return topology;
}

/** A type's field as a rule names it: the IRI its type declares for it. */
const fieldOf = (definition: TDomainDefinition, field: string): string => `<${declaredFieldIri(storedTopology(definition), field)}>`;

/** The IRI of a relation's predicate. */
const predicate = (name: string): string => `<${RELATION_NAMESPACE}${name}>`;

const SOURCE = fieldOf(specificResourceDomainDefinition, LinkRelations.HAS_SOURCE.rel);
const STATED = fieldOf(specificResourceDomainDefinition, SOURCE_DIGEST);
const HELD = fieldOf(bodyDomainDefinition, BODY_DIGEST);

/** The relations by which a record quotes through anchors: a note's target, and the passages a record cites as evidence of its
 *  values, which any type that cites passages declares under one IRI. */
const QUOTING = [fieldOf(commentDomainDefinition, LinkRelations.TARGET.rel), `<${iriIn(namespacesOfType({}), LinkRelations.CITES_AS_EVIDENCE.uri)}>`];

/** The name of the relation, and of the facts its rules derive on the way: an anchor whose Body changed after it quoted the Body, and
 *  an anchor a record quotes through by any of `QUOTING`, so one rule reads every anchor of a record, whatever relation reaches it. */
const [CURRENT, STALE, QUOTES_THROUGH] = [predicate("anchor_current"), predicate("anchor_stale"), predicate("quotes_through")];

/** An anchor that quotes its Body as the Body reads, and a record each of whose anchors does. */
export const ANCHOR_CURRENT: TRelation = {
	name: "anchor_current",
	phrase: "{anchor} quotes its Body as the Body reads",
	rules: [
		`{ ?a ${SOURCE} ?b . ?a ${STATED} ?d . ?b ${HELD} ?d } => { (?a) ${CURRENT} true } .`,
		`{ ?a ${SOURCE} ?b . ?a ${STATED} ?d . ?s <${LOG.notIncludes}> { ?b ${HELD} ?d } } => { (?a) ${STALE} true } .`,
		...QUOTING.map((quoting) => `{ ?r ${quoting} ?a } => { (?r ?a) ${QUOTES_THROUGH} true } .`),
		`{ (?r ?a) ${QUOTES_THROUGH} true . (?a) ${CURRENT} true . ?s <${LOG.notIncludes}> { (?r ?x) ${QUOTES_THROUGH} true . (?x) ${STALE} true } } => { (?r) ${CURRENT} true } .`,
	].join("\n"),
};

/** The edges a check of `anchor_current` reads the records of: an anchor's Body, and a note's anchors. A contract that states the
 *  relation states them complete, with the edge by which a record of its own type cites passages, where it cites them. */
export const ANCHOR_COMPLETE: readonly TField[] = [
	edge({ topology: storedTopology(specificResourceDomainDefinition) }, LinkRelations.HAS_SOURCE.rel),
	edge({ topology: storedTopology(commentDomainDefinition) }, LinkRelations.TARGET.rel),
];

/** The relations a contract or a claim states over anchors. */
export const ANCHOR_RELATIONS: readonly TRelation[] = [ANCHOR_CURRENT];

/** Returns the check that the record a call states as its parameter `name` quotes its Bodies as they read, and the edges the check
 *  follows to read the record's anchors and their Bodies, with `quoting`, the edges by which records of the type quote passages. */
export const anchorCurrentCheck = (name: string, quoting: readonly TField[]): TContractChecking => ({
	statements: [holds(ANCHOR_CURRENT, parameter(name))],
	complete: [...ANCHOR_COMPLETE, ...quoting],
});
