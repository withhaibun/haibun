import { describe, it, expect } from "vitest";
import { EARL_ASSERTION_EDGE, EARL_LABEL, EARL_MODE, EARL_OUTCOME, earlDomainDefinitions, type TEarlAssertions } from "../domains/earl.js";
import { writeEarlAssertions } from "./check-page.js";
import { systemClock } from "@haibun/core/lib/actuality/adapters/system-clock.js";
import { buildConcernCatalog, getJsonLdContext } from "@haibun/core/lib/domains/hypermedia.js";
import { toRegisteredDomain } from "@haibun/core/lib/domains/domains.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { readEvery, recordOf } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { declaredTypeOf, storeDeclaring } from "@haibun/core/lib/test/declared-types.js";

/** The EARL types, declared so the store reads their records. */
const EARL_TYPES = Object.fromEntries(earlDomainDefinitions.map(declaredTypeOf));

const registered = Object.fromEntries(earlDomainDefinitions.map((definition) => [definition.selectors[0], toRegisteredDomain(definition)]));

const STEP = "1791034142780-1.0.1.2";
const IMAGE_ALT = { id: "https://example.com/rules/image-alt", name: "Images must have alternative text", tags: ["wcag2a", "wcag111"] };
const TITLE = { id: "https://example.com/rules/document-title", name: "Documents must have a title" };
const assertions = (step: string): TEarlAssertions => ({
	assertor: { id: "https://example.com/checker/1.0", name: "checker 1.0" },
	subject: { id: "https://example.com/page", url: "https://example.com/page" },
	mode: EARL_MODE.automatic,
	step,
	results: [
		{ test: IMAGE_ALT, result: { outcome: EARL_OUTCOME.failed, info: "Fix the image", pointers: ["#hero img"], impact: "critical" } },
		{ test: TITLE, result: { outcome: EARL_OUTCOME.passed } },
	],
});

describe("EARL types", () => {
	it("are persisted types the concern catalog accepts, each assertion edge reaching its EARL class", () => {
		const catalog = buildConcernCatalog(registered);
		expect(catalog.persisted[EARL_LABEL.assertion]?.edges).toMatchObject({
			[EARL_ASSERTION_EDGE.assertedBy]: { targets: [EARL_LABEL.assertor] },
			[EARL_ASSERTION_EDGE.subject]: { targets: [EARL_LABEL.testSubject] },
			[EARL_ASSERTION_EDGE.test]: { targets: [EARL_LABEL.testCase] },
			[EARL_ASSERTION_EDGE.result]: { targets: [EARL_LABEL.testResult] },
			[EARL_ASSERTION_EDGE.wasGeneratedBy]: { targets: [SEQ_PATH_LABEL] },
		});
	});
	it("serve each class as a subclass of its EARL class, and each property as its EARL term", () => {
		const served = getJsonLdContext(registered);
		const context = served["@context"] as Record<string, { "@id": string; "@context": Record<string, { "@id": string }> }>;
		const superclassOf = (label: string): unknown => served["@graph"].find((node) => node["@id"] === context[label]?.["@id"])?.["rdfs:subClassOf"];
		const assertion = context[EARL_LABEL.assertion];
		expect(superclassOf(EARL_LABEL.assertion)).toContainEqual({ "@id": "earl:Assertion" });
		expect(Object.fromEntries(Object.values(EARL_ASSERTION_EDGE).map((edge) => [edge, assertion?.["@context"][edge]?.["@id"]]))).toEqual({
			assertedBy: "earl:assertedBy",
			subject: "earl:subject",
			test: "earl:test",
			result: "earl:result",
			wasGeneratedBy: "prov:wasGeneratedBy",
		});
		const result = context[EARL_LABEL.testResult];
		expect(superclassOf(EARL_LABEL.testResult)).toContainEqual({ "@id": "earl:TestResult" });
		expect([result?.["@context"].outcome?.["@id"], result?.["@context"].pointers?.["@id"], result?.["@context"].info?.["@id"]]).toEqual([
			"earl:outcome",
			"earl:pointer",
			"earl:info",
		]);
		for (const [label, earl] of [
			[EARL_LABEL.assertor, "earl:Assertor"],
			[EARL_LABEL.testSubject, "earl:TestSubject"],
			[EARL_LABEL.testCase, "earl:TestCase"],
		] as const)
			expect(superclassOf(label)).toContainEqual({ "@id": earl });
	});
});

describe("writeEarlAssertions", () => {
	it("records each result as an assertion the step made, linked to the assertor, the subject, the test case and the result", async () => {
		const store = storeDeclaring(EARL_TYPES);
		const ids = await writeEarlAssertions({ store, clock: systemClock }, assertions(STEP));
		expect(ids).toEqual([`${STEP} ${IMAGE_ALT.id}`, `${STEP} ${TITLE.id}`]);
		const edges = await store.query({ subject: itemAt(ids, 0), namedGraph: EARL_LABEL.assertion });
		const target = (edge: string) => edges.find((quad) => quad.predicate === edge);
		expect(target(EARL_ASSERTION_EDGE.assertedBy)).toMatchObject({ object: "https://example.com/checker/1.0", objectType: EARL_LABEL.assertor });
		expect(target(EARL_ASSERTION_EDGE.subject)).toMatchObject({ object: "https://example.com/page", objectType: EARL_LABEL.testSubject });
		expect(target(EARL_ASSERTION_EDGE.test)).toMatchObject({ object: IMAGE_ALT.id, objectType: EARL_LABEL.testCase });
		expect(target(EARL_ASSERTION_EDGE.wasGeneratedBy)).toMatchObject({ object: STEP, objectType: SEQ_PATH_LABEL });
		const resultId = String(target(EARL_ASSERTION_EDGE.result)?.object);
		expect(await recordOf(store, EARL_LABEL.testResult, resultId)).toMatchObject({
			outcome: EARL_OUTCOME.failed,
			info: "Fix the image",
			pointers: ["#hero img"],
			impact: "critical",
		});
		expect(await recordOf(store, EARL_LABEL.assertion, itemAt(ids, 0))).toMatchObject({ mode: EARL_MODE.automatic });
	});
	it("shares one record of a test case, an assertor and a subject among the assertions that name them", async () => {
		const store = storeDeclaring(EARL_TYPES);
		await writeEarlAssertions({ store, clock: systemClock }, assertions(STEP));
		await writeEarlAssertions({ store, clock: systemClock }, assertions(`${STEP}.1`));
		expect(await readEvery(store, { label: EARL_LABEL.assertion })).toHaveLength(4);
		expect(await readEvery(store, { label: EARL_LABEL.testResult })).toHaveLength(4);
		expect(await readEvery(store, { label: EARL_LABEL.testCase })).toHaveLength(2);
		expect(await readEvery(store, { label: EARL_LABEL.assertor })).toHaveLength(1);
		expect(await readEvery(store, { label: EARL_LABEL.testSubject })).toHaveLength(1);
	});
});
