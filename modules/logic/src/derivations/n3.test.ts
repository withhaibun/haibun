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
import { DataFactory } from "n3";
import { LOG } from "@haibun/core/lib/domains/vocabularies.js";
import { reasoner } from "../root.js";
import { listItems, pattern, patternText, quadsOf, quadsText, recordTerms, ruleText } from "./n3.js";

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
		expect(individual.value).toBe(iriIn(context, recordIri(RECORDS.prefix, "Mailbox", ID)));
		expect(individual.value.startsWith(`${RECORDS.namespace}mailbox/`)).toBe(true);
		expect(terms.addressOf(individual)).toEqual({ persistedAs: "Mailbox", id: ID });
		expect(() => terms.addressOf(DataFactory.namedNode(`${RECORDS.namespace}folder/a`))).toThrow(/isn't the IRI of a record of a persisted type/);
	});

	it("refuses a context that doesn't bind the records' prefix, and two types whose labels are one label in lower case", () => {
		const domains = mapDefinitionsToDomains([typeOf("Mailbox"), typeOf("MailBox")]);
		expect(() => recordTerms(buildConcernCatalog(domains), getJsonLdContext(domains)["@context"], RECORDS)).toThrow(/doesn't bind the records' prefix record/);
		expect(() => recordTerms(buildConcernCatalog(domains), getJsonLdContext(domains, undefined, RECORDS)["@context"], RECORDS)).toThrow(/share a label in lower case/);
	});
});

describe("the formula writer", () => {
	const awkward = "a literal with _:o . and _:s, braces { } and => inside";
	const [subject, predicate] = [DataFactory.namedNode("urn:t:s"), DataFactory.namedNode("urn:t:p")];

	it("writes a formula in place of a blank node at its position, so a literal's text never reads as a formula", () => {
		const fact = pattern(subject, predicate, DataFactory.literal(awkward));
		expect(patternText(pattern({ formula: [fact] }, LOG.implies, { formula: [fact] }))).toBe(`{ ${patternText(fact)} } <${LOG.implies}> { ${patternText(fact)} } .`);
		expect(patternText(fact)).toBe(`<urn:t:s> <urn:t:p> ${JSON.stringify(awkward)} .`);
	});

	it("round-trips a literal that holds a placeholder's form, braces and an arrow through EYE unchanged", { timeout: 30_000 }, async () => {
		const derived = pattern(subject, DataFactory.namedNode("urn:t:derived"), "?v");
		const sources = [quadsText([DataFactory.quad(subject, predicate, DataFactory.literal(awkward))]), ruleText([pattern(subject, predicate, "?v")], [derived])].join("\n");
		const text = await reasoner().session(async (session) => {
			const state = await session.start(sources, ruleText([derived], [derived]), false);
			if ("need" in state) throw new Error("the rules read only their own facts");
			return state.derived;
		});
		expect(quadsOf(text).map(({ object }) => object.value)).toEqual([awkward]);
	});
});

describe("a list the reasoner's output states", () => {
	it("reads each item in order, in time that grows with the list's length", () => {
		const ITEMS = 20_000;
		const quads = quadsOf(`<urn:x:s> <urn:x:p> (${Array.from({ length: ITEMS }, (_, at) => `"${at}"`).join(" ")}) .`);
		const head = quads.find(({ predicate }) => predicate.value === "urn:x:p")?.object;
		if (head === undefined) throw new Error("the test's list doesn't parse");
		const start = performance.now();
		const items = listItems(quads, head).map(({ value }) => value);
		const took = performance.now() - start;
		expect(items).toEqual(Array.from({ length: ITEMS }, (_, at) => String(at)));
		expect(took, `${ITEMS} items took ${took.toFixed(0)} ms`).toBeLessThan(1_000);
	});
});
