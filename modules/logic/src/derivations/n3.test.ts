/**
 * The N3 terms of records: each record is named by its record IRI as the served context expands it, under whatever namespace
 * the context binds to the records' prefix, and two types whose labels are one label in lower case are refused, since their
 * records would share IRIs.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { buildConcernCatalog, getJsonLdContext } from "@haibun/core/lib/domains/hypermedia.js";
import { Access, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { iriIn } from "@haibun/core/lib/records/derivations/owl.js";
import { recordIri } from "@haibun/core/lib/records/derivations/record-iri.js";
import { recordTerms } from "./n3.js";

const typeOf = (persistedAs: string) => ({
	selectors: [persistedAs],
	schema: z.object({ id: z.string(), generatedAtTime: z.string() }),
	description: persistedAs,
	topology: { persistedAs, id: "id", accessLevel: Access.private, properties: { id: LinkRelations.IDENTIFIER.rel } },
});
const RECORDS = { prefix: "record", namespace: "https://records.example/records/" };
const ID = "work/INBOX é";

describe("recordTerms", () => {
	it("names a record by its record IRI under an HTTP namespace, and reads its address back from it", () => {
		const domains = mapDefinitionsToDomains([typeOf("Mailbox")]);
		const context = getJsonLdContext(domains, undefined, RECORDS)["@context"];
		const terms = recordTerms(buildConcernCatalog(domains), context, RECORDS);
		const individual = terms.individualAt(`Mailbox:${ID}`);
		expect(individual).toBe(iriIn(context, recordIri(RECORDS.prefix, "Mailbox", ID)));
		expect(individual.startsWith(`${RECORDS.namespace}mailbox/`)).toBe(true);
		expect(terms.addressOf(`<${individual}>`)).toEqual({ persistedAs: "Mailbox", id: ID });
		expect(() => terms.addressOf(`<${RECORDS.namespace}folder/a>`)).toThrow(/isn't the IRI of a record of a persisted type/);
	});

	it("refuses a context that doesn't bind the records' prefix, and two types whose labels are one label in lower case", () => {
		const domains = mapDefinitionsToDomains([typeOf("Mailbox"), typeOf("MailBox")]);
		expect(() => recordTerms(buildConcernCatalog(domains), getJsonLdContext(domains)["@context"], RECORDS)).toThrow(/doesn't bind the records' prefix record/);
		expect(() => recordTerms(buildConcernCatalog(domains), getJsonLdContext(domains, undefined, RECORDS)["@context"], RECORDS)).toThrow(/share a label in lower case/);
	});
});
