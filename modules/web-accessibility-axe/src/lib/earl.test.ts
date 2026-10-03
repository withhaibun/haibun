import { describe, it, expect } from "vitest";
import { EARL_ASSERTION_EDGE, EARL_LABEL, EARL_MODE, EARL_OUTCOME, earlDomainDefinitions, writeEarlAssertions, type TEarlAssertions } from "./earl.js";
import { buildConcernCatalog, getJsonLdContext } from "@haibun/core/lib/hypermedia.js";
import { toRegisteredDomain } from "@haibun/core/lib/domains.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { QuadStore } from "@haibun/core/lib/quad-store.js";

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
		const { edges } = catalog.persisted[EARL_LABEL.assertion];
		expect(edges[EARL_ASSERTION_EDGE.assertedBy].targets).toEqual([EARL_LABEL.assertor]);
		expect(edges[EARL_ASSERTION_EDGE.subject].targets).toEqual([EARL_LABEL.testSubject]);
		expect(edges[EARL_ASSERTION_EDGE.test].targets).toEqual([EARL_LABEL.testCase]);
		expect(edges[EARL_ASSERTION_EDGE.result].targets).toEqual([EARL_LABEL.testResult]);
		expect(edges[EARL_ASSERTION_EDGE.wasGeneratedBy].targets).toEqual([SEQ_PATH_LABEL]);
	});
	it("serve each class and property as its EARL term", () => {
		const context = getJsonLdContext(registered)["@context"] as Record<string, { "@id": string; "@context": Record<string, { "@id": string }> }>;
		const assertion = context[EARL_LABEL.assertion];
		expect(assertion["@id"]).toBe("earl:Assertion");
		expect(Object.fromEntries(Object.values(EARL_ASSERTION_EDGE).map((edge) => [edge, assertion["@context"][edge]?.["@id"]]))).toEqual({
			assertedBy: "earl:assertedBy",
			subject: "earl:subject",
			test: "earl:test",
			result: "earl:result",
			wasGeneratedBy: "prov:wasGeneratedBy",
		});
		const result = context[EARL_LABEL.testResult];
		expect(result["@id"]).toBe("earl:TestResult");
		expect([result["@context"].outcome["@id"], result["@context"].pointers["@id"], result["@context"].info["@id"]]).toEqual(["earl:outcome", "earl:pointer", "earl:info"]);
		expect([EARL_LABEL.assertor, EARL_LABEL.testSubject, EARL_LABEL.testCase].map((label) => context[label]["@id"])).toEqual(["earl:Assertor", "earl:TestSubject", "earl:TestCase"]);
	});
});

describe("writeEarlAssertions", () => {
	it("records each result as an assertion the step made, linked to the assertor, the subject, the test case and the result", async () => {
		const store = new QuadStore();
		const ids = await writeEarlAssertions(store, assertions(STEP));
		expect(ids).toEqual([`${STEP} ${IMAGE_ALT.id}`, `${STEP} ${TITLE.id}`]);
		const edges = await store.query({ subject: ids[0], namedGraph: EARL_LABEL.assertion });
		const target = (edge: string) => edges.find((quad) => quad.predicate === edge);
		expect(target(EARL_ASSERTION_EDGE.assertedBy)).toMatchObject({ object: "https://example.com/checker/1.0", objectType: EARL_LABEL.assertor });
		expect(target(EARL_ASSERTION_EDGE.subject)).toMatchObject({ object: "https://example.com/page", objectType: EARL_LABEL.testSubject });
		expect(target(EARL_ASSERTION_EDGE.test)).toMatchObject({ object: IMAGE_ALT.id, objectType: EARL_LABEL.testCase });
		expect(target(EARL_ASSERTION_EDGE.wasGeneratedBy)).toMatchObject({ object: STEP, objectType: SEQ_PATH_LABEL });
		const resultId = String(target(EARL_ASSERTION_EDGE.result)?.object);
		expect(await store.getIndividual(EARL_LABEL.testResult, resultId)).toMatchObject({ outcome: EARL_OUTCOME.failed, info: "Fix the image", pointers: ["#hero img"], impact: "critical" });
		expect(await store.getIndividual(EARL_LABEL.assertion, ids[0])).toMatchObject({ mode: EARL_MODE.automatic });
	});
	it("shares one record of a test case, an assertor and a subject among the assertions that name them", async () => {
		const store = new QuadStore();
		await writeEarlAssertions(store, assertions(STEP));
		await writeEarlAssertions(store, assertions(`${STEP}.1`));
		expect(await store.queryIndividuals(EARL_LABEL.assertion)).toHaveLength(4);
		expect(await store.queryIndividuals(EARL_LABEL.testResult)).toHaveLength(4);
		expect(await store.queryIndividuals(EARL_LABEL.testCase)).toHaveLength(2);
		expect(await store.queryIndividuals(EARL_LABEL.assertor)).toHaveLength(1);
		expect(await store.queryIndividuals(EARL_LABEL.testSubject)).toHaveLength(1);
	});
});
