/** The claim scope the claim tests check: three declared types under PROV-O's classes, a Person's email FOAF's mailbox, and a Step
 *  and a Note recorded. The conformance test replays the sessions of these checks through translated clauses. */
import { z } from "zod";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { Access, GeneratedAtTimeSchema, HAIBUN_RECORD_NAMESPACE, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { FOAF_MBOX } from "@haibun/core/lib/domains/vocabularies.js";
import { storeOfDomains } from "@haibun/core/lib/test/declared-types.js";
import { declareVocabularies } from "../root.js";
import type { TClaimScope } from "../pipelines/claims.js";
import type { TReasoner } from "../ports.js";

declareVocabularies(["prov", "foaf"]);

export const [STEP, NOTE, PERSON] = ["Step", "Note", "Person"];
const typeOf = (persistedAs: string, subClassOf: string) => ({
	selectors: [persistedAs.toLowerCase()],
	schema: z.object({ id: z.string(), email: z.string().optional(), generatedAtTime: GeneratedAtTimeSchema }),
	description: persistedAs,
	topology: {
		persistedAs,
		subClassOf,
		id: "id",
		accessLevel: Access.private,
		properties: { id: LinkRelations.IDENTIFIER.rel, email: { rel: LinkRelations.IDENTIFIER.rel, iri: FOAF_MBOX } },
	},
});
const definitions = [typeOf(STEP, "prov:Activity"), typeOf(NOTE, "prov:Entity"), typeOf(PERSON, "prov:Agent")];
const domains = mapDefinitionsToDomains(definitions);

/** The mailbox two Persons recorded under different ids share. */
export const SHARED_MAILBOX = "alice@example.org";

/** Returns the claim scope over `reasoner`, with a Step s1 and a Note n1 recorded, and Persons p1 and p2 with one mailbox. */
export async function scopeWith(reasoner: TReasoner): Promise<TClaimScope> {
	const store = storeOfDomains(definitions);
	for (const [subject, namedGraph] of [
		["s1", STEP],
		["n1", NOTE],
	] as const)
		await store.merge({ "@type": namedGraph, id: subject, accessLevel: Access.private });
	for (const id of ["p1", "p2"]) await store.merge({ "@type": PERSON, id, email: SHARED_MAILBOX, accessLevel: Access.private });
	return { reasoner, store, domains, records: HAIBUN_RECORD_NAMESPACE };
}
