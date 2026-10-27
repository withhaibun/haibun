import { describe, it, expect } from "vitest";
import { prefixesReferencedBy } from "./jsonld-context-scope.js";

describe("prefixesReferencedBy: the context view carries only the type's own vocabulary", () => {
	// The Document context node (as served): its @id and field terms reference doc/dcterms/hbn/as/status/
	// prov/oa (values) and hbn/rdfs (keys), but NOT sosa/foaf/otel/wallet the whole store also declares.
	const docNode = {
		"@id": "doc:Document",
		"@context": [
			"https://example.org/contexts/document/v1",
			{
				id: { "@id": "dcterms:identifier", "hbn:rel": "item", "@type": "@id" },
				type: { "@id": "@type", "hbn:rel": "select" },
				format: { "@id": "hbn:format", "hbn:rel": "filter" },
				statusIndex: { "@id": "status:index", "hbn:rel": "select" },
				status: { "@id": "doc:status", "@type": "@id", "hbn:rel": "item" },
				generatedAtTime: { "@id": "prov:generatedAtTime", "hbn:rel": "filter" },
				issuer: { "@id": "doc:issuer", "@type": "@id", "hbn:rel": "item", "rdfs:subPropertyOf": "hbn:fromActor" },
				hasBody: { "@id": "oa:hasBody", "@type": "@id", "hbn:rel": "item" },
			},
		],
	};

	it("collects the prefixes a type node references (values + keys), skipping keywords and absolute IRIs", () => {
		const used = prefixesReferencedBy(docNode);
		// exactly the prefixes this node references, dcterms/doc/hbn/oa/prov/rdfs/status (term @ids), hbn (format + rel keys), rdfs (key)
		expect([...used].sort()).toEqual(["dcterms", "doc", "hbn", "oa", "prov", "rdfs", "status"]);
		// the whole-store prefixes a document does NOT use are absent
		for (const p of ["sosa", "foaf", "otel", "wallet", "dgsi", "oid4vp", "schema", "sec"]) expect(used.has(p)).toBe(false);
		// keywords (@type) and the absolute standardContext URL are not prefixes
		expect(used.has("@type")).toBe(false);
		expect(used.has("https")).toBe(false);
	});
});
