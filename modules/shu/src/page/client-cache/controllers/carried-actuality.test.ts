// @vitest-environment jsdom
/**
 * An actuality carried in a page: what a standalone report embeds is the graph its execution wrote, filled into a store of the
 * page's own at boot, and the window then reads that actuality exactly as it reads one a site is recording. A payload written to
 * another rule is refused rather than read wrongly.
 */
import { declareRegistry, GRAPH_READ_STEPS } from "../../../test/catalog-fixture.js";
import { ServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { CACHE_SHAPE } from "../ports.js";
import type { TCachePayload } from "../../../domains/hydration.js";
import { cachedGraph, currentExecution, hydrateClientCache, pageDeviceStore } from "./device-controller.js";
import { actualityWindow } from "../pipelines/actuality-window.js";
import { ACTUALITY_WINDOW_SIZE } from "../derivations/actuality-rows.js";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { ACTUALITY_DOMAIN_DEFINITIONS } from "../actuality-store.test-fake.js";
import { setupShuTest, stepsShown, type TShuTestHandle } from "../../../test/setup.js";
import { pageActualityGraph } from "../../controllers/read-controller.js";

const EXECUTION = "1700000000000-1";
const iso = (n: number): string => new Date(n).toISOString();
/** The steps of the reported actuality, as the quads a report carries. */
const stepQuads = Array.from({ length: 12 }, (_, i) => [
	{ subject: `${EXECUTION}.0.${i}`, predicate: "id", object: `${EXECUTION}.0.${i}`, namedGraph: SEQ_PATH_LABEL, timestamp: 1 },
	{ subject: `${EXECUTION}.0.${i}`, predicate: "stepText", object: `step ${i}`, namedGraph: SEQ_PATH_LABEL, timestamp: 1 },
	{ subject: `${EXECUTION}.0.${i}`, predicate: "generatedAtTime", object: iso(2000 + i), namedGraph: SEQ_PATH_LABEL, timestamp: 1 },
	{ subject: `${EXECUTION}.0.${i}`, predicate: "level", object: "info", namedGraph: SEQ_PATH_LABEL, timestamp: 1 },
	{ subject: `${EXECUTION}.0.${i}`, predicate: "actionStatus", object: "passed", namedGraph: SEQ_PATH_LABEL, timestamp: 1 },
]).flat();

const payload = (over: Partial<TCachePayload> = {}): TCachePayload => ({
	shape: CACHE_SHAPE,
	execution: EXECUTION,
	registry: { steps: [], domains: {}, concerns: { persisted: {} } },
	quads: stepQuads,
	...over,
});

describe("an actuality carried in a page", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		// A page without a site: every request fails, as it does for a report opened from a file.
		handle = setupShuTest({
			dispatch: () => {
				throw new ServerUnreachable("/rpc", new Error("this page lacks a site"));
			},
		});
		// What the site declared, which a report carries as its registry: the graph's reads, and the declarations through which
		// the page reads a carried actuality's records.
		declareRegistry(stepsShown(GRAPH_READ_STEPS, {}, buildConcernCatalog(mapDefinitionsToDomains(ACTUALITY_DOMAIN_DEFINITIONS))));
	});
	afterEach(() => {
		handle.teardown();
	});

	it("is read as any actuality is read: the window over the records its execution wrote", async () => {
		await hydrateClientCache(payload({ registry: undefined }));
		// A page carrying an actuality reads it through the page's own graph, which this case asserts.
		const window = await actualityWindow(pageActualityGraph(), { execution: EXECUTION, size: ACTUALITY_WINDOW_SIZE, minLevel: "info", substeps: false });
		expect(window.rows.length, "actuality the page carries").toBe(12);
		expect(itemAt(window.rows, 0).text).toBe("step 0");
		expect(itemAt(window.rows, 11).text).toBe("step 11");
		expect(currentExecution(), "the execution the page carries is the one being read").toBe(EXECUTION);
	});

	it("carries the registry, so the page holds the site's declarations without a site to read", async () => {
		await hydrateClientCache(payload());
		expect((await pageDeviceStore().registry())?.response).toEqual({ steps: [], domains: {}, concerns: { persisted: {} } });
	});

	it("refuses a payload written to another rule rather than reading it wrongly", async () => {
		await expect(hydrateClientCache(payload({ shape: "some-earlier-rule/0" }))).rejects.toThrow(/doesn't read/);
	});

	it("carries the graph, in a store of the page's own rather than the origin's", async () => {
		const quads = [
			{ subject: "c1", predicate: "content", object: "hello", namedGraph: "Comment", timestamp: 1 },
			{ subject: "c1", predicate: "author", object: "did:example:a", namedGraph: "Comment", timestamp: 2 },
		];
		await hydrateClientCache(payload({ quads }));
		expect((await cachedGraph().query({ subject: "c1" })).length, "the graph the page carries is what the graph views read").toBe(2);
		expect(await cachedGraph().get("c1", "content", "Comment")).toBe("hello");
	});
});
