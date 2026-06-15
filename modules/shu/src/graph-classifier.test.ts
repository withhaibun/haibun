import { describe, it, expect } from "vitest";
import { THREAD_CLASSIFIER, buildClassifier, isUri, INTERNAL_PREDICATES } from "./graph-classifier.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";

describe("THREAD_CLASSIFIER", () => {
	it("classifies name as name, edges as edge, internal as internal", () => {
		expect(THREAD_CLASSIFIER.classify("Email", "name")).toBe("name");
		expect(THREAD_CLASSIFIER.classify("Email", "from")).toBe("edge");
		expect(THREAD_CLASSIFIER.classify("Email", "subject")).toBe("edge");
		expect(THREAD_CLASSIFIER.classify("Email", "_id")).toBe("internal");
	});
});

describe("buildClassifier sorts predicates by their declared rel, never by value", () => {
	const rels: Record<string, string> = { title: LinkRelations.NAME.rel, ident: LinkRelations.IDENTIFIER.rel, body: LinkRelations.CONTENT.rel, link: LinkRelations.URL.rel };
	const edgeRanges: Record<string, string> = { author: "Person" };
	const classifier = buildClassifier(
		() => rels,
		() => edgeRanges,
	);

	it("treats _-prefixed predicates and INTERNAL_PREDICATES as internal", () => {
		expect(classifier.classify("G", "_x")).toBe("internal");
		expect(classifier.classify("G", "accessLevel")).toBe("internal");
		expect(INTERNAL_PREDICATES.has("accessLevel")).toBe(true);
	});
	it("classifies a predicate with a declared edge range as an edge", () => {
		expect(classifier.classify("G", "author")).toBe("edge");
	});
	it("maps the name / identifier / content rels to their kinds", () => {
		expect(classifier.classify("G", "title")).toBe("name");
		expect(classifier.classify("G", "ident")).toBe("identifier");
		expect(classifier.classify("G", "body")).toBe("content");
	});
	it("treats a URL-ranged rel as an edge (URI strings are navigable)", () => {
		expect(classifier.classify("G", "link")).toBe("edge");
	});
	it("defaults to scalar for a predicate with no recognised rel", () => {
		expect(classifier.classify("G", "mystery")).toBe("scalar");
	});
});

describe("isUri", () => {
	it("recognises did / urn / http(s) / absolute-path forms, rejects plain text", () => {
		for (const u of ["did:web:x", "urn:uuid:1", "https://x", "http://x", "/path"]) expect(isUri(u)).toBe(true);
		expect(isUri("plain-string")).toBe(false);
	});
});
