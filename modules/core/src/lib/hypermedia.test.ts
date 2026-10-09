import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildConcernCatalog, composeDisplayLabel, composeTitle, MAX_DISPLAY_LABEL_LEN, queryableFields } from "./hypermedia.js";
import type { TDomainDefinition, THypermediaTopology } from "./resources.js";
import { mapDefinitionsToDomains } from "./domains.js";
import {
	Access,
	isPersisted,
	LinkRelations,
	specificResourceDomainDefinition,
	textQuoteSelectorDomainDefinition,
	commentDomainDefinition,
	principalDomainDefinition,
} from "./resources.js";

const props = (o: Record<string, unknown>) => (f: string) => o[f];

describe("composeDisplayLabel priority: headline → body → weak → id", () => {
	it("uses NAME when present, over a body and a seqPath", () => {
		const rels = { subject: LinkRelations.NAME.rel, seqPath: LinkRelations.SEQ_PATH.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ subject: "RE: Meeting", seqPath: "0.1" }), bodyContents: ["the body"], id: "e1" })).toBe("RE: Meeting");
	});

	it("uses rdfs:label over the entity's NAME, since an explicit display label takes precedence", () => {
		const rels = { label: LinkRelations.LABEL.rel, name: LinkRelations.NAME.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ label: "Coastal Fisheries Authority", name: "should-not-win" }), bodyContents: [], id: "did:web:x" })).toBe(
			"Coastal Fisheries Authority",
		);
	});

	it("titles a node without a name, such as a Principal, by its rdfs:label instead of its id", () => {
		const rels = { label: LinkRelations.LABEL.rel, controller: LinkRelations.CONTROLLER.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ label: "Importer Co.", controller: "did:web:x" }), bodyContents: [], id: "did:web:x" })).toBe("Importer Co.");
	});

	it("uses an inline CONTENT field when the node doesn't have a name", () => {
		const rels = { text: LinkRelations.CONTENT.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ text: "inline note" }), bodyContents: [], id: "n1" })).toBe("inline note");
	});

	it("uses the linked-body preview over a seqPath, as a Comment carries both", () => {
		const rels = { seqPath: LinkRelations.SEQ_PATH.rel, author: LinkRelations.ATTRIBUTED_TO.rel };
		const label = composeDisplayLabel({ rels, getProperty: props({ seqPath: "0.-1.26", author: "did:x" }), bodyContents: ["Lawrence vouches for this"], id: "cmt-say-0.-1.26" });
		expect(label).toBe("Lawrence vouches for this");
		expect(label).not.toContain("seqPath");
	});

	it("falls to a weak provenance pointer only when the node doesn't have a headline or body", () => {
		const rels = { seqPath: LinkRelations.SEQ_PATH.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ seqPath: "0.1" }), bodyContents: [], id: "x" })).toBe("seqPath: 0.1");
	});

	it("falls to the subject id when a title doesn't resolve", () => {
		expect(composeDisplayLabel({ rels: {}, getProperty: () => undefined, bodyContents: [], id: "n1" })).toBe("n1");
		expect(composeDisplayLabel({ rels: undefined, getProperty: () => undefined, id: "n2" })).toBe("n2");
	});

	it("titles a type by the labeling property its own vocabulary declares, when it doesn't have a shared headline", () => {
		// oa:exact is a property, so the selector's title is the value the node holds.
		const rels = { exact: LinkRelations.EXACT.rel, id: LinkRelations.IDENTIFIER.rel };
		const label = composeDisplayLabel({
			rels,
			getProperty: props({ exact: "a passage inside the document", id: "sel-1" }),
			displayLabel: { key: "exact", through: false },
			id: "sel-1",
		});
		expect(label).toBe("a passage inside the document");
	});

	it("titles a proxy through its declared edge with the title of the edge's target", () => {
		// oa:hasSelector is an edge. The SpecificResource doesn't have text of its own, so its title is its selector's title.
		const rels = { id: LinkRelations.IDENTIFIER.rel };
		const args = { rels, getProperty: props({ id: "sr-1" }), id: "sr-1" };
		expect(composeDisplayLabel({ ...args, displayLabel: { key: "hasSelector", through: true, linkedLabel: "a passage inside the document" } })).toBe(
			"a passage inside the document",
		);
		// An unresolved or access-filtered edge target doesn't have a title, so the label is the id and not a blank title.
		expect(composeDisplayLabel({ ...args, displayLabel: { key: "hasSelector", through: true } })).toBe("sr-1");
		expect(composeDisplayLabel({ ...args, displayLabel: { key: "hasSelector", through: true, linkedLabel: "  " } })).toBe("sr-1");
	});

	it("an explicit rdfs:label takes precedence over the type's declared labeling property", () => {
		const rels = { exact: LinkRelations.EXACT.rel, label: LinkRelations.LABEL.rel };
		const label = composeDisplayLabel({ rels, getProperty: props({ exact: "the quote", label: "What this marks" }), displayLabel: { key: "exact", through: false }, id: "sel-1" });
		expect(label).toBe("What this marks");
	});

	it("a declared labeling property takes precedence over the shared headline, since the type's own vocabulary is more specific", () => {
		const rels = { exact: LinkRelations.EXACT.rel, name: LinkRelations.NAME.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ exact: "the quote", name: "generic name" }), displayLabel: { key: "exact", through: false }, id: "x" })).toBe(
			"the quote",
		);
	});

	it("titles by a list property's members, and by the title of an edge's target record", () => {
		const kinds = ["EmployeeCredential", "BadgeCredential"];
		expect(composeDisplayLabel({ rels: {}, getProperty: props({ type: kinds }), displayLabel: { key: "type", through: false }, id: "x" })).toBe(kinds.join(", "));
		expect(composeDisplayLabel({ rels: {}, getProperty: props({}), displayLabel: { key: "checkedCredential", through: true, linkedLabel: kinds[0] }, id: "x" })).toBe(kinds[0]);
	});

	it("core types declare a labeling property only where the shared headline can't title them", () => {
		const topologyOf = ({ selectors, topology }: TDomainDefinition) => {
			if (!isPersisted(topology)) throw new Error(`${selectors.join()} doesn't declare a persisted topology`);
			return topology;
		};
		expect(topologyOf(textQuoteSelectorDomainDefinition).displayLabel).toBe("exact");
		expect(topologyOf(specificResourceDomainDefinition).displayLabel).toBe("hasSelector");
		// A Comment is titled by its own note text (as:name or content), so it doesn't declare a vocabulary-specific title.
		expect(topologyOf(commentDomainDefinition).displayLabel).toBeUndefined();
		expect(topologyOf(principalDomainDefinition).displayLabel).toBeUndefined();
	});

	it("rejects a declared labeling property that the type doesn't carry, since the record would display without a title and without an error", () => {
		const topology: THypermediaTopology = {
			persistedAs: "Thing",
			accessLevel: Access.private,
			id: "id",
			properties: { id: LinkRelations.IDENTIFIER.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
			displayLabel: "exact",
		};
		const domains = mapDefinitionsToDomains([{ selectors: ["thing"], description: "d", schema: z.object({ id: z.string(), generatedAtTime: z.string() }), topology }]);
		expect(() => buildConcernCatalog(domains)).toThrow(/displayLabel "exact", which isn't one of its properties or edges/);
	});

	it("picks the shortest non-empty body as the concise summary", () => {
		expect(composeDisplayLabel({ rels: undefined, getProperty: () => undefined, bodyContents: ["x".repeat(300), "short", ""], id: "a" })).toBe("short");
	});

	it("clamps to MAX_DISPLAY_LABEL_LEN with an ellipsis", () => {
		const label = composeDisplayLabel({ rels: undefined, getProperty: () => undefined, bodyContents: ["y".repeat(200)], id: "a" });
		expect(label.length).toBe(MAX_DISPLAY_LABEL_LEN);
		expect(label.endsWith("…")).toBe(true);
	});

	it("composes the same title without the label's bound, so a caller bounds it to its own length", () => {
		const subject = `RE: ${"the estuary tide table ".repeat(8)}`;
		const args = { rels: { subject: LinkRelations.NAME.rel }, getProperty: props({ subject: `  ${subject}  ` }), id: "e1" };
		expect(composeTitle(args)).toBe(subject.trim());
		expect(composeDisplayLabel(args)).toHaveLength(MAX_DISPLAY_LABEL_LEN);
	});
});

describe("queryableFields: the one declaration-side derivation of a type's queryable surface", () => {
	const schema = z.object({
		messageId: z.string(),
		subject: z.string(),
		folder: z.string(),
		size: z.number(),
		flagged: z.boolean().optional(),
		generatedAtTime: z.coerce.date().default(() => new Date()),
		attachments: z.array(z.object({ name: z.string() })),
	});
	const topology: THypermediaTopology = {
		persistedAs: "Email",
		accessLevel: Access.private,
		id: "messageId",
		properties: { subject: LinkRelations.NAME.rel, folder: LinkRelations.CONTEXT.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
		sortColumns: { receivedAt: "TIMESTAMPTZ" },
	};

	it("returns declared sortColumns, CONTEXT facets, the record-time field and bounded primitives, and leaves out plain strings and the identifier", () => {
		expect(queryableFields({ schema, topology })).toEqual(["flagged", "folder", "generatedAtTime", "receivedAt", "size"]);
	});

	it("resolves a content-object property def to its rel, so a body field isn't queryable", () => {
		const withBody: THypermediaTopology = { ...topology, properties: { ...topology.properties, body: { rel: "content", mediaType: "text/html" } } };
		expect(queryableFields({ schema, topology: withBody })).not.toContain("body");
	});

	it("derives the fields of a `set of {domain}` prose declaration from its sortColumns when it doesn't have a schema shape", () => {
		const proseTopology: THypermediaTopology = { persistedAs: "Recipe", accessLevel: Access.private, id: "name", properties: {}, sortColumns: { servings: "DOUBLE PRECISION" } };
		expect(queryableFields({ schema: undefined, topology: proseTopology })).toEqual(["servings"]);
	});
});

describe("validTimeField: the catalog names the field that places a type's individuals in time", () => {
	it("is the declared defaultSort when present, and generatedAtTime otherwise", () => {
		const schema = z.object({ id: z.string(), receivedAt: z.coerce.date(), generatedAtTime: z.coerce.date().default(() => new Date()) });
		const make = (persistedAs: string, defaultSort?: string): TDomainDefinition => ({
			selectors: [persistedAs.toLowerCase()],
			schema,
			description: persistedAs,
			topology: {
				persistedAs,
				accessLevel: Access.private,
				id: "id",
				properties: { id: LinkRelations.IDENTIFIER.rel, receivedAt: LinkRelations.PUBLISHED.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
				...(defaultSort ? { defaultSort } : {}),
			},
		});
		const cat = buildConcernCatalog(mapDefinitionsToDomains([make("Message", "receivedAt"), make("Note")]));
		expect(cat.persisted.Message?.validTimeField).toBe("receivedAt");
		expect(cat.persisted.Note?.validTimeField).toBe(LinkRelations.GENERATED_AT_TIME.rel);
	});
});

/**
 * A type's vocabulary prefix is a declaration and not prose, so it must resolve. The server returns the records of a type
 * with an unbound prefix without an error, and a reader's JSON-LD processor doesn't expand the term to an IRI.
 * buildConcernCatalog therefore rejects an unbound prefix at build, as it rejects an unknown rel.
 */
describe("buildConcernCatalog vocabulary binding", () => {
	const domain = (topology: Partial<THypermediaTopology>) =>
		mapDefinitionsToDomains([
			{
				selectors: ["thing"],
				description: "d",
				schema: z.object({ id: z.string(), generatedAtTime: z.string() }),
				topology: {
					persistedAs: "Thing",
					id: "id",
					properties: { id: LinkRelations.IDENTIFIER.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
					...topology,
				} as THypermediaTopology,
			},
		]);

	it("rejects a class named in a vocabulary the type never bound", () => {
		expect(() => buildConcernCatalog(domain({ type: "vcard:Individual" }))).toThrow(/"vcard:" vocabulary is not bound/);
	});

	it("accepts the class once the type declares the prefix's IRI", () => {
		expect(() => buildConcernCatalog(domain({ type: "vcard:Individual", namespaces: { vcard: "http://www.w3.org/2006/vcard/ns#" } }))).not.toThrow();
	});

	it("accepts an undeclared prefix that core binds for every domain", () => {
		expect(() => buildConcernCatalog(domain({ type: "oa:SpecificResource" }))).not.toThrow();
		expect(() => buildConcernCatalog(domain({ subClassOf: "prov:Agent" }))).not.toThrow();
	});

	it("applies the same rule to a superclass, a property's iri and an edge's iri", () => {
		expect(() => buildConcernCatalog(domain({ subClassOf: "cred:Thing" }))).toThrow(/"cred:" vocabulary is not bound/);
		expect(() =>
			buildConcernCatalog(
				domain({ properties: { id: LinkRelations.IDENTIFIER.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel, x: { rel: LinkRelations.TAG.rel, iri: "vcstatus:x" } } }),
			),
		).toThrow(/"vcstatus:" vocabulary is not bound/);
		expect(() => buildConcernCatalog(domain({ edges: { e: { rel: LinkRelations.HAS_BODY.rel, range: "Thing", iri: "zzz:e" } } }))).toThrow(/"zzz:" vocabulary is not bound/);
	});

	it("accepts an absolute IRI and a bare local name, since these don't name a vocabulary to bind", () => {
		expect(() => buildConcernCatalog(domain({ type: "https://www.w3.org/ns/did#DIDDocument" }))).not.toThrow();
		expect(() => buildConcernCatalog(domain({ subClassOf: "Thing" }))).not.toThrow();
	});
});

describe("buildConcernCatalog field declarations", () => {
	const ADDRESS = "url";
	const KEY = "publicKeyMultibase";
	const domain = (field: string, { properties, edges }: Pick<THypermediaTopology, "properties" | "edges">) =>
		mapDefinitionsToDomains([
			{
				selectors: ["thing"],
				description: "d",
				schema: z.object({ id: z.string(), [field]: z.string(), generatedAtTime: z.string() }),
				topology: {
					persistedAs: "Thing",
					accessLevel: Access.private,
					id: "id",
					properties: { id: LinkRelations.IDENTIFIER.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel, ...properties },
					edges,
				},
			},
		]);

	it("rejects a schema field that the topology doesn't name, and names the field and the change", () => {
		expect(() => buildConcernCatalog(domain(ADDRESS, { properties: {} }))).toThrow(
			`has schema fields that its topology doesn't name: ${ADDRESS}. Map each field to its relation in topology.properties or topology.edges, or remove it from the schema`,
		);
	});

	it("accepts a schema field that an edge names", () => {
		expect(() => buildConcernCatalog(domain(ADDRESS, { properties: {}, edges: { [ADDRESS]: { rel: LinkRelations.MENTIONS.rel, range: "Thing" } } }))).not.toThrow();
	});

	it("rejects a field mapped to tag where a relation is named for it, and names the relation", () => {
		expect(() => buildConcernCatalog(domain(ADDRESS, { properties: { [ADDRESS]: LinkRelations.TAG.rel } }))).toThrow(
			`maps property "${ADDRESS}" to "${LinkRelations.TAG.rel}", and the relation "${LinkRelations.URL.rel}" (${LinkRelations.URL.uri}) is named for it. Map "${ADDRESS}" to "${LinkRelations.URL.rel}"`,
		);
		expect(() => buildConcernCatalog(domain(ADDRESS, { properties: { [ADDRESS]: LinkRelations.URL.rel } }))).not.toThrow();
	});

	it("finds the relation named for a field by the local name of the relation's IRI", () => {
		expect(() => buildConcernCatalog(domain(KEY, { properties: { [KEY]: LinkRelations.TAG.rel } }))).toThrow(
			`the relation "${LinkRelations.PUBLIC_KEY.rel}" (${LinkRelations.PUBLIC_KEY.uri}) is named for it`,
		);
	});
});
