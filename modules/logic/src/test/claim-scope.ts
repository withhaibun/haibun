/** The claim scope the claim tests check: three declared types under PROV-O's classes, a Person's email FOAF's mailbox, and a Step
 *  and the Note it generated recorded, the Note's edge to the Step stated as a reference. The conformance test replays the sessions of these checks through translated clauses. */
import { z } from "zod";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { Access, GeneratedAtTimeSchema, HAIBUN_RECORD_NAMESPACE, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { FOAF_MBOX } from "@haibun/core/lib/domains/vocabularies.js";
import { storeOfDomains } from "@haibun/core/lib/test/declared-types.js";
import { referenceTo } from "@haibun/core/lib/records/domains/unit.js";
import { declareVocabularies } from "../root.js";
import type { TClaimScope } from "../pipelines/claims.js";
import type { TReasoner } from "../ports.js";

declareVocabularies(["prov", "foaf"]);

export const [STEP, NOTE, PERSON] = ["Step", "Note", "Person"];
const typeOf = (persistedAs: string, subClassOf: string, edges: Record<string, { range: string }> = {}) => ({
	selectors: [persistedAs.toLowerCase()],
	schema: z.object({ id: z.string(), email: z.string().optional(), generatedAtTime: GeneratedAtTimeSchema }),
	description: persistedAs,
	topology: {
		persistedAs,
		subClassOf,
		id: "id",
		accessLevel: Access.private,
		properties: { id: LinkRelations.IDENTIFIER.rel, email: { rel: LinkRelations.IDENTIFIER.rel, iri: FOAF_MBOX } },
		edges,
	},
});
const definitions = [typeOf(STEP, "prov:Activity"), typeOf(NOTE, "prov:Entity", { [LinkRelations.WAS_GENERATED_BY.rel]: { range: STEP } }), typeOf(PERSON, "prov:Agent")];
const domains = mapDefinitionsToDomains(definitions);

/** The mailbox two Persons recorded under different ids share. */
export const SHARED_MAILBOX = "alice@example.org";

/** Returns the claim scope over `reasoner`, with a Step s1 and a Note n1 it generated recorded, and Persons p1 and p2 with one mailbox. */
export async function scopeWith(reasoner: TReasoner): Promise<TClaimScope> {
	const store = storeOfDomains(definitions);
	await store.merge({ "@type": STEP, id: "s1", accessLevel: Access.private });
	await store.merge({ "@type": NOTE, id: "n1", accessLevel: Access.private, [LinkRelations.WAS_GENERATED_BY.rel]: referenceTo(STEP, "s1") });
	for (const id of ["p1", "p2"]) await store.merge({ "@type": PERSON, id, email: SHARED_MAILBOX, accessLevel: Access.private });
	return { reasoner, store, domains, records: HAIBUN_RECORD_NAMESPACE };
}
