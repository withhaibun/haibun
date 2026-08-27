// @vitest-environment node
// What a report carries, driven through the real writer and read back out of the compressed payload it embeds.
// A report is the page with the run it reports held inside it: the run in the client cache, the site's declarations
// beside it, and the component bundles of the views that were open. It carries no answers a live page happened to
// receive, since every read a view makes is answered from what the page holds.
import { describe, it, expect } from "vitest";
import type { IStepperCycles } from "@haibun/core/lib/astepper.js";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { registerDomains } from "@haibun/core/lib/domains.js";
import { DISCOVERY_RESPONSE } from "@haibun/web-server-hono/web-server-stepper.js";
import { DOMAIN_GRAPH_QUERY } from "@haibun/core/lib/quad-types.js";
import MonitorStepper from "./monitor-stepper.js";
import StorageMem from "@haibun/storage-mem/storage-mem.js";
import ShuStepper from "./shu-stepper.js";

const GRAPH_VIEW = "shu-polymorphic-graph-view";

/** Pull the inlined component scripts back out of the report's compressed payload. */
function reportScripts(html: string): string[] {
	const b64 = html.match(/<script[^>]*id="shu-payload"[^>]*>([^<]+)<\/script>/)?.[1];
	if (!b64) throw new Error("shu-payload script not found in report HTML");
	const { scripts } = JSON.parse(gunzipSync(Buffer.from(b64, "base64")).toString("utf-8")) as { scripts: string[] };
	return scripts;
}

/** What the report holds of the run, read back out of the payload: the client cache and the replay beside it. */
function reportHydration(html: string): { cache: { registry?: { steps?: unknown[] } }; rpcCache: Record<string, unknown> } {
	const b64 = html.match(/<script[^>]*id="shu-payload"[^>]*>([^<]+)<\/script>/)?.[1];
	if (!b64) throw new Error("shu-payload script not found in report HTML");
	const { hydration } = JSON.parse(gunzipSync(Buffer.from(b64, "base64")).toString("utf-8")) as { hydration: string };
	return JSON.parse(hydration);
}

/** A step that ran a graph query, as the run records one: the argument it took carries the graph-query domain and the
 *  type the query named, whichever step a deployment answers queries with. */
const queryEvent = (stepperName: string, label: string) => ({
	id: "0.2",
	timestamp: 0,
	kind: "lifecycle",
	type: "step",
	stage: "start",
	level: "trace",
	in: "graph query",
	stepperName,
	actionName: "graphQuery",
	stepValuesMap: { query: { term: JSON.stringify({ label }), value: { label }, origin: 3, domain: DOMAIN_GRAPH_QUERY } },
});

/** Generate a report with `finalView` (a domain key) as the final-view column, using the real GraphStepper domains.
 *  `served` is the discovery response this server gave a page; `writes` is how many reports the same run writes, since
 *  a run writes one whenever it is asked and one at its end. */
async function generateReport(finalView: string | undefined, served?: unknown, writes = 1, queries: Array<Record<string, unknown>> = []): Promise<string> {
	const world = getDefaultWorld();
	const shu = new ShuStepper();
	const monitor = new MonitorStepper();
	const storage = new StorageMem(); // satisfies MonitorStepper.setWorld's storage lookup; the report itself writes to fixedPath
	const steppers = [shu, monitor, storage];
	registerDomains(
		world,
		steppers.map((s) => (s as { cycles?: IStepperCycles }).cycles?.getConcerns?.().domains ?? []).filter((d) => d.length > 0),
	);
	if (served) world.runtime[DISCOVERY_RESPONSE] = served;
	// The store + secrets are irrelevant to the component-inclusion rule; stub them so report generation runs.
	(world.shared as unknown as { getStore: () => unknown }).getStore = () => ({});
	(world.shared as unknown as { getSecrets: () => Promise<Record<string, string>> }).getSecrets = async () => ({});
	for (const s of steppers) await s.setWorld(world, steppers);
	if (finalView) {
		const event = { id: "0.1", timestamp: 0, kind: "lifecycle", stage: "end", level: "info", products: { view: finalView } };
		await monitor.cycles.onEvent?.(event as unknown as Parameters<NonNullable<typeof monitor.cycles.onEvent>>[0]);
	}
	for (const q of queries) await monitor.cycles.onEvent?.(q as unknown as Parameters<NonNullable<typeof monitor.cycles.onEvent>>[0]);
	const out = join(tmpdir(), `polymorphic-report-${process.pid}-${finalView ?? "none"}.html`);
	for (let i = 0; i < writes; i++) await (monitor.steps.savesShuTo.action as (a: { where: string }) => Promise<unknown>)({ where: out });
	return readFileSync(out, "utf-8");
}

describe("serialized report bundles an external component's JS iff its view is used", () => {
	it("EMBEDS the real graph view's bundle when the polymorphic view is the final view", async () => {
		const scripts = reportScripts(await generateReport(GRAPH_VIEW));
		const viewScript = scripts.find((s) => s.includes(GRAPH_VIEW));
		expect(viewScript).toBeDefined();
		expect((viewScript ?? "").length).toBeGreaterThan(100_000); // the actual bundle, not a stray reference
	});

	it("OMITS the graph view's bundle when no polymorphic view is shown", async () => {
		const scripts = reportScripts(await generateReport(undefined));
		expect(scripts.some((s) => s.includes(GRAPH_VIEW))).toBe(false);
	});
});

describe("a report carries the run and the site's declarations, and no captured answer", () => {
	const declarations = { steps: [{ method: "GraphStepper-graphQuery", stepperName: "GraphStepper", stepName: "graphQuery", pattern: "graph query {query}" }], domains: {}, concerns: { persisted: {} } };

	it("carries the declarations this server served a page, and still does when the same run writes a second report", async () => {
		expect(reportHydration(await generateReport(undefined, declarations)).cache.registry?.steps, "the first report").toEqual(declarations.steps);
		expect(reportHydration(await generateReport(undefined, declarations, 2)).cache.registry?.steps, "and the one written when the run ends").toEqual(declarations.steps);
	});

	it("carries no answer a live page received, since a view reads what the page holds", async () => {
		const replayed = Object.keys(reportHydration(await generateReport(undefined, declarations)).rpcCache);
		expect(replayed.filter((k) => k.includes("graphQuery")), "the rows a query returned are the graph, which rides in the cache").toEqual([]);
		expect(replayed.includes("step.list"), "and the declarations ride in the cache, not beside it").toBe(false);
	});
});

describe("a report opens on the type the reader was looking at", () => {
	// Switching type in the actions bar runs a graph query, and the run records that step. The type is read from the
	// argument's domain, so a deployment answering queries with its own step is read the same way as the inherent one.
	const viewHash = (html: string): string => (reportHydration(html) as unknown as { viewHash: string }).viewHash;

	it("opens on the type the last query named, whichever step answered it", async () => {
		expect(viewHash(await generateReport(undefined, undefined, 1, [queryEvent("MonitorStepper", "Comment")]))).toContain("label=Comment");
		expect(viewHash(await generateReport(undefined, undefined, 1, [queryEvent("GraphStepper", "Email")]))).toContain("label=Email");
	});

	it("opens on the type switched to, not the one switched away from", async () => {
		expect(viewHash(await generateReport(undefined, undefined, 1, [queryEvent("GraphStepper", "Email"), queryEvent("GraphStepper", "Person")]))).toContain("label=Person");
	});

	it("names no type when the run never queried one", async () => {
		expect(viewHash(await generateReport(undefined))).not.toContain("label=");
	});
});
