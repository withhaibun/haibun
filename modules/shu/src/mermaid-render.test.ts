// @vitest-environment node
// Server-side mermaid rendering: source → SVG in Node (jsdom), with no document/window left on the process.
import { describe, it, expect } from "vitest";
import { renderMermaidToSvg } from "./mermaid-render.js";
import { buildMermaidSource, type PropertyClassifier, type TGraphViewOpts } from "./mermaid-source.js";

const CONTENT_CLASSIFIER: PropertyClassifier = { classify: (_g, p) => (p === "content" ? "content" : p === "name" ? "name" : p === "narrate" ? "edge" : "scalar") };
const OPTS: TGraphViewOpts = { layout: "TD", hiddenGraphs: new Set(), expandedGraphs: new Set(), maxPerSubgraph: 20 };
const q = (subject: string, predicate: string, object: string, objectType?: string) => ({ subject, predicate, object, objectType, namedGraph: "G", timestamp: 0 });

describe("renderMermaidToSvg (server-side)", () => {
	it("renders a flowchart source to SVG", async () => {
		const svg = await renderMermaidToSvg("graph TD\n A[Alpha] --> B[Beta]");
		expect(svg).toContain("<svg");
		expect(svg).toContain("Alpha");
	});

	it("recomputes a finite, non-degenerate viewBox from the laid-out geometry", async () => {
		const svg = await renderMermaidToSvg("graph TD\n A[Alpha] --> B[Beta]");
		const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
		expect(viewBox).toBeDefined();
		const [, , w, h] = (viewBox as string).split(/\s+/).map(Number);
		expect(w).toBeGreaterThan(0);
		expect(h).toBeGreaterThan(0);
		expect(w).toBeLessThan(2000);
		expect(h).toBeLessThan(2000);
	});

	it("renders a node whose content has embedded newlines/tabs without a parse error (label stays one line)", async () => {
		// A multi-line body (e.g. an offer/comment) once produced a `["…"]` label split across source lines, which
		// mermaid rejects with "Expecting 'LINK'… got 'STR'". esc() must collapse the whitespace so the label is one line.
		const { source } = buildMermaidSource(
			[q("g_offer-JUN-05-2026-Completed", "content", "accepted offer - 408 units of grain\nfrom the Sledge co-op\twith terms"), q("g_offer-JUN-05-2026-Completed", "narrate", "g_other", "G"), q("g_other", "content", "Counterparty")],
			OPTS,
			CONTENT_CLASSIFIER,
		);
		const labelLine = source.split("\n").find((l) => l.includes("accepted offer"));
		expect(labelLine).toBeDefined();
		expect(labelLine).not.toMatch(/[\r\n]/); // the label is a single source line
		await expect(renderMermaidToSvg(source)).resolves.toContain("<svg");
	});

	it("serializes concurrent renders and restores process globals", async () => {
		const [a, b] = await Promise.all([renderMermaidToSvg("graph TD\nC[Gamma]-->D[Delta]"), renderMermaidToSvg("graph LR\nE[Epsilon]-->F[Zeta]")]);
		expect(a).toContain("<svg");
		expect(b).toContain("<svg");
		expect((globalThis as Record<string, unknown>).window).toBeUndefined();
		expect((globalThis as Record<string, unknown>).document).toBeUndefined();
	});
});
