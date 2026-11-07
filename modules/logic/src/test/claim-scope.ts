/** The claim scope the claim tests check: three declared types under PROV-O's classes, and a Step and a Note recorded. The conformance
 *  test replays the sessions of these checks through translated clauses. */
import { z } from "zod";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { Access, GeneratedAtTimeSchema, HAIBUN_RECORD_NAMESPACE, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { storeOfDomains } from "@haibun/core/lib/test/declared-types.js";
import { declareVocabularies } from "../root.js";
import type { TClaimScope } from "../pipelines/claims.js";
import type { TReasoner } from "../ports.js";

declareVocabularies(["prov"]);

export const [STEP, NOTE, PERSON] = ["Step", "Note", "Person"];
const typeOf = (persistedAs: string, subClassOf: string) => ({
	selectors: [persistedAs.toLowerCase()],
	schema: z.object({ id: z.string(), generatedAtTime: GeneratedAtTimeSchema }),
	description: persistedAs,
	topology: { persistedAs, subClassOf, id: "id", accessLevel: Access.private, properties: { id: LinkRelations.IDENTIFIER.rel } },
});
const definitions = [typeOf(STEP, "prov:Activity"), typeOf(NOTE, "prov:Entity"), typeOf(PERSON, "prov:Agent")];
const domains = mapDefinitionsToDomains(definitions);

/** Returns the claim scope over `reasoner`, with a Step s1 and a Note n1 recorded. */
export async function scopeWith(reasoner: TReasoner): Promise<TClaimScope> {
	const store = storeOfDomains(definitions);
	for (const [subject, namedGraph] of [
		["s1", STEP],
		["n1", NOTE],
	] as const)
		await store.add({ subject, predicate: "id", object: subject, namedGraph, accessLevel: Access.private });
	return { reasoner, store, domains, records: HAIBUN_RECORD_NAMESPACE };
}
