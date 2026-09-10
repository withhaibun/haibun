// @vitest-environment jsdom
/**
 * A run carried in a page: what a standalone report embeds is the graph the run wrote, filled into a store of the page's
 * own at boot, and the window then reads that run exactly as it reads one a site is recording. A payload written to
 * another rule is refused rather than read wrongly.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { CACHE_SHAPE, deviceStore } from "./device-store.js";
import { hydrateClientCache, type TCachePayload } from "./hydrate.js";
import { currentExecution, resetExecutions } from "./executions.js";
import { runWindow } from "./run-window.js";
import { cachedGraphStore, pageRunGraph } from "../quads-snapshot.js";
import { setSiteMetadata, type SiteMetadata } from "../rels-cache.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";

const EXECUTION = "1700000000000-1";
const iso = (n: number): string => new Date(n).toISOString();
/** The steps of the reported run, as the quads a report carries them by. */
const stepQuads = Array.from({ length: 12 }, (_, i) => [
	{ subject: `${EXECUTION}.0.${i}`, predicate: "id", object: `${EXECUTION}.0.${i}`, namedGraph: SEQ_PATH_LABEL, timestamp: 1 },
	{ subject: `${EXECUTION}.0.${i}`, predicate: "stepText", object: `step ${i}`, namedGraph: SEQ_PATH_LABEL, timestamp: 1 },
	{ subject: `${EXECUTION}.0.${i}`, predicate: "generatedAtTime", object: iso(2000 + i), namedGraph: SEQ_PATH_LABEL, timestamp: 1 },
	{ subject: `${EXECUTION}.0.${i}`, predicate: "level", object: "info", namedGraph: SEQ_PATH_LABEL, timestamp: 1 },
]).flat();

const payload = (over: Partial<TCachePayload> = {}): TCachePayload => ({
	shape: CACHE_SHAPE,
	execution: EXECUTION,
	registry: { steps: [], domains: {}, concerns: { persisted: {} } },
	quads: stepQuads,
	...over,
});

describe("a run carried in a page", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		// A page with no site: every request fails, as it does for a report opened from a file.
		handle = setupShuTest({
			dispatch: () => {
				throw new Error("this page has no site");
			},
		});
		// What the site declared, which a report carries as its registry: a type the page does not know is one it holds
		// no records of, so the window would ask a question with no answer.
		setSiteMetadata({ types: [SEQ_PATH_LABEL], rels: { [SEQ_PATH_LABEL]: {} }, edgeRanges: {} } as unknown as SiteMetadata);
	});
	afterEach(() => {
		handle.teardown();
		resetExecutions();
	});

	it("is read as any run is read: the window over the records the run wrote", async () => {
		await hydrateClientCache(payload({ registry: undefined }));
		// A page carrying a run reads it through the page's own graph, which this case asserts.
		const window = await runWindow(pageRunGraph(), { execution: EXECUTION });
		expect(window.rows.length, "the run the page carries").toBe(12);
		expect(window.rows[0].text).toBe("step 0");
		expect(window.rows[11].text).toBe("step 11");
		expect(currentExecution(), "the execution the page carries is the one being read").toBe(EXECUTION);
	});

	it("carries the registry, so the page knows the site's declarations with no site to ask", async () => {
		await hydrateClientCache(payload());
		expect((await deviceStore().registry())?.response).toEqual({ steps: [], domains: {}, concerns: { persisted: {} } });
	});

	it("refuses a payload written to another rule rather than reading it wrongly", async () => {
		await expect(hydrateClientCache(payload({ shape: "some-earlier-rule/0" }))).rejects.toThrow(/does not read/);
	});

	it("carries the graph, in a store of the page's own rather than the origin's", async () => {
		const quads = [
			{ subject: "c1", predicate: "content", object: "hello", namedGraph: "Comment", timestamp: 1 },
			{ subject: "c1", predicate: "author", object: "did:example:a", namedGraph: "Comment", timestamp: 2 },
		];
		await hydrateClientCache(payload({ quads }));
		expect((await cachedGraphStore().query({ subject: "c1" })).length, "the graph the page carries is what the graph views read").toBe(2);
		expect(await cachedGraphStore().get("c1", "content", "Comment")).toBe("hello");
	});
});
