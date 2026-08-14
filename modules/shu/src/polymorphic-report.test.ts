// @vitest-environment node
// End-to-end guard: when a feature USES an external component view (the A-Frame fisheye), the serialized HTML report
// must actually embed that component's bundle — and must NOT carry it when the view isn't shown. This drives the real
// chain (graph-stepper's fisheye domain ui.jsContent → final-view cols → inlineScriptsForView → compressed payload →
// HTML), then decompresses the payload to confirm the bundle is present, so the "include external components on use"
// behaviour can never silently regress again.
import { describe, it, expect } from "vitest";
import type { IStepperCycles } from "@haibun/core/lib/astepper.js";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { registerDomains } from "@haibun/core/lib/domains.js";
import { RPC_CACHE } from "@haibun/web-server-hono/web-server-stepper.js";
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

/** Generate a report with `finalView` (a domain key) as the final-view column, using the real GraphStepper domains. */
async function generateReport(finalView: string | undefined): Promise<string> {
	const world = getDefaultWorld();
	const shu = new ShuStepper();
	const monitor = new MonitorStepper();
	const storage = new StorageMem(); // satisfies MonitorStepper.setWorld's storage lookup; the report itself writes to fixedPath
	const steppers = [shu, monitor, storage];
	registerDomains(
		world,
		steppers.map((s) => (s as { cycles?: IStepperCycles }).cycles?.getConcerns?.().domains ?? []).filter((d) => d.length > 0),
	);
	world.runtime[RPC_CACHE] = {};
	// The store + secrets are irrelevant to the component-inclusion rule; stub them so report generation runs.
	(world.shared as unknown as { getStore: () => unknown }).getStore = () => ({});
	(world.shared as unknown as { getSecrets: () => Promise<Record<string, string>> }).getSecrets = async () => ({});
	for (const s of steppers) await s.setWorld(world, steppers);
	if (finalView) {
		const event = { id: "0.1", timestamp: 0, kind: "lifecycle", stage: "end", level: "info", products: { view: finalView } };
		await monitor.cycles.onEvent?.(event as unknown as Parameters<NonNullable<typeof monitor.cycles.onEvent>>[0]);
	}
	const out = join(tmpdir(), `polymorphic-report-${process.pid}-${finalView ?? "none"}.html`);
	await (monitor.steps.savesShuTo.action as (a: { where: string }) => Promise<unknown>)({ where: out });
	return readFileSync(out, "utf-8");
}

describe("serialized report bundles an external component's JS iff its view is used", () => {
	it("EMBEDS the real graph view's bundle when the fisheye view is the final view", async () => {
		const scripts = reportScripts(await generateReport(GRAPH_VIEW));
		const viewScript = scripts.find((s) => s.includes(GRAPH_VIEW));
		expect(viewScript).toBeDefined();
		expect((viewScript ?? "").length).toBeGreaterThan(100_000); // the actual bundle, not a stray reference
	});

	it("OMITS the graph view's bundle when no fisheye view is shown", async () => {
		const scripts = reportScripts(await generateReport(undefined));
		expect(scripts.some((s) => s.includes(GRAPH_VIEW))).toBe(false);
	});
});
