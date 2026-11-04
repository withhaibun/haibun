/**
 * The registry's vocabularies as the reasoner reads them: each copy matches the digest its entry pins, its subsumptions and
 * disjointness of named classes are applied and its other axioms are stated, not reasoned over, and a copy whose digest
 * differs is refused, naming where the published file is.
 */
import { describe, expect, it } from "vitest";
import { VOCABULARY_ENTRIES, vocabularyEntry } from "@haibun/core/lib/domains/vocabulary-registry.js";
import { NAMESPACE } from "@haibun/core/lib/domains/vocabularies.js";
import { vocabularyAxioms } from "./vocabulary-library.js";

const PROV = NAMESPACE.prov;

describe("the vocabulary library", () => {
	it("reads each registered vocabulary from a copy whose digest its entry pins", () => {
		for (const entry of VOCABULARY_ENTRIES) expect(vocabularyAxioms(entry).stated, entry.title).toBeGreaterThan(0);
	});

	it("applies PROV-O's disjointness of activities and entities, and states the rest", () => {
		const prov = vocabularyAxioms(vocabularyEntry("prov"));
		expect(prov.disjointWith).toContainEqual([`${PROV}Activity`, `${PROV}Entity`]);
		expect(prov.subClassOf).toContainEqual([`${PROV}Plan`, `${PROV}Entity`]);
		expect(prov.stated).toBe(1146 - prov.subClassOf.length - prov.disjointWith.length);
	});

	it("refuses a copy whose digest isn't the one its entry pins", () => {
		const entry = { ...vocabularyEntry("foaf"), digest: "0".repeat(64) };
		expect(() => vocabularyAxioms(entry)).toThrow(`its registry entry pins ${"0".repeat(64)}. Restore the file published at ${entry.source}.`);
	});
});
