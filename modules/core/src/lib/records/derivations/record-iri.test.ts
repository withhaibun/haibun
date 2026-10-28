/**
 * A record's IRI and its inverse: the label in lower case, the id percent-encoded as an RFC 3986 path segment, and the same
 * IRI expanded through a context whatever scheme its namespace has, so an HTTP origin round-trips as a URN does.
 */
import { describe, expect, it } from "vitest";
import { getJsonLdContext } from "../../domains/hypermedia.js";
import { z } from "zod";
import { mapDefinitionsToDomains } from "../../domains/domains.js";
import { Access, HAIBUN_RECORD_NAMESPACE, LinkRelations } from "../../domains/resources.js";
import { iriIn } from "./owl.js";
import { recordIri, recordOfIri } from "./record-iri.js";

const PREFIX = "record";
/** An id holding each kind of character a path segment reserves, a space, a non-ASCII letter and a percent sign. */
const RESERVED_ID = "work/INBOX ?#[]@!$&'()*+,;=% é";

describe("recordIri", () => {
	it("names a record by its label in lower case and its id percent-encoded, and its inverse reads both back", () => {
		const iri = recordIri(PREFIX, "Mailbox", RESERVED_ID);
		expect(iri).toBe("record:mailbox/work%2FINBOX%20%3F%23%5B%5D%40%21%24%26%27%28%29%2A%2B%2C%3B%3D%25%20%C3%A9");
		expect(recordOfIri(iri)).toEqual({ prefix: PREFIX, lowerLabel: "mailbox", id: RESERVED_ID });
	});

	it("reads text without a label, with an id recordIri doesn't write, or with a scheme's path as undefined", () => {
		expect(recordOfIri("record:a")).toBeUndefined();
		expect(recordOfIri("record:mailbox/a b")).toBeUndefined();
		expect(recordOfIri("did:key:z6Mk/a")).toBeUndefined();
	});

	it("expands through the context that binds its prefix, and an HTTP origin as the namespace round-trips", () => {
		const records = { prefix: PREFIX, namespace: "https://records.example:8443/records/" };
		const context = getJsonLdContext({}, undefined, records)["@context"];
		const expanded = iriIn(context, recordIri(records.prefix, "Mailbox", RESERVED_ID));
		expect(expanded).toBe(`${records.namespace}mailbox/work%2FINBOX%20%3F%23%5B%5D%40%21%24%26%27%28%29%2A%2B%2C%3B%3D%25%20%C3%A9`);
		expect(new URL(expanded).pathname.split("/").length, "the id is one path segment").toBe(4);
		expect(recordOfIri(`${records.prefix}:${expanded.slice(records.namespace.length)}`)).toEqual({ prefix: PREFIX, lowerLabel: "mailbox", id: RESERVED_ID });
	});

	it("refuses records named under a prefix a type binds to its vocabulary", () => {
		const domains = mapDefinitionsToDomains([
			{
				selectors: ["note"],
				schema: z.object({ id: z.string(), generatedAtTime: z.string() }),
				description: "Note",
				topology: {
					persistedAs: "Note",
					id: "id",
					accessLevel: Access.private,
					namespaces: { [PREFIX]: "https://vocabulary.example/" },
					properties: { id: LinkRelations.IDENTIFIER.rel },
				},
			},
		]);
		expect(() => getJsonLdContext(domains, undefined, { prefix: PREFIX, namespace: "urn:records:" })).toThrow(
			/Note binds record to https:\/\/vocabulary.example\/, which the records' @ids name/,
		);
	});

	it("keeps haibun's namespace bound to the serving host where haibun's records are stated", () => {
		const host = "https://192.0.2.9:8223/ns/";
		expect(getJsonLdContext({}, host, HAIBUN_RECORD_NAMESPACE)["@context"][HAIBUN_RECORD_NAMESPACE.prefix]).toBe(host);
	});
});
