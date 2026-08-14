import { describe, it, expect } from "vitest";
import { prefixesReferencedBy } from "./jsonld-context-scope.js";

describe("prefixesReferencedBy — the context view carries only the type's own vocabulary", () => {
	// The VerifiableCredential context node (as served): its @id and field terms reference cred/dcterms/hbn/as/vcstatus/
	// prov/oa (values) and hbn/rdfs (keys) — but NOT sosa/foaf/otel/wallet the whole store also declares.
	const vcNode = {
		"@id": "cred:VerifiableCredential",
		"@context": [
			"https://www.w3.org/ns/credentials/v2",
			{
				id: { "@id": "dcterms:identifier", "hbn:rel": "item", "@type": "@id" },
				type: { "@id": "@type", "hbn:rel": "select" },
				format: { "@id": "hbn:format", "hbn:rel": "filter" },
				statusListIndex: { "@id": "vcstatus:statusListIndex", "hbn:rel": "select" },
				credentialStatus: { "@id": "cred:credentialStatus", "@type": "@id", "hbn:rel": "item" },
				generatedAtTime: { "@id": "prov:generatedAtTime", "hbn:rel": "filter" },
				issuer: { "@id": "cred:issuer", "@type": "@id", "hbn:rel": "item", "rdfs:subPropertyOf": "hbn:fromActor" },
				hasBody: { "@id": "oa:hasBody", "@type": "@id", "hbn:rel": "item" },
			},
		],
	};

	it("collects the prefixes a type node references (values + keys), skipping keywords and absolute IRIs", () => {
		const used = prefixesReferencedBy(vcNode);
		// exactly the prefixes this node references — cred/dcterms/vcstatus/prov/oa (term @ids), hbn (format + rel keys), rdfs (key)
		expect([...used].sort()).toEqual(["cred", "dcterms", "hbn", "oa", "prov", "rdfs", "vcstatus"]);
		// the whole-store prefixes a credential does NOT use are absent
		for (const p of ["sosa", "foaf", "otel", "wallet", "dgsi", "oid4vp", "schema", "sec"]) expect(used.has(p)).toBe(false);
		// keywords (@type) and the absolute standardContext URL are not prefixes
		expect(used.has("@type")).toBe(false);
		expect(used.has("https")).toBe(false);
	});
});
