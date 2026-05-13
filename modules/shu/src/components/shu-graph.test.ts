// @vitest-environment jsdom
/**
 * Runtime contract for the generic graph view.
 *
 * The component must:
 *  - accept a TGraph via `products.graph` and render through its injected renderer,
 *  - re-render on subsequent `products` assignments (so chain-walker advances repaint),
 *  - re-dispatch `graph-node-click` events composed across the shadow boundary,
 *  - reject products without a TGraph (no silent failure).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ShuGraph } from "./shu-graph.js";
import type { IGraphRenderer, TGraph, TGraphRenderOptions } from "../graph/types.js";
import { SHU_EVENT } from "../consts.js";

class RecordingRenderer implements IGraphRenderer {
	calls: Array<{ graph: TGraph; options?: TGraphRenderOptions }> = [];
	emitClick = false;
	render(graph: TGraph, container: HTMLElement, options?: TGraphRenderOptions): Promise<void> {
		this.calls.push({ graph, options });
		container.textContent = `nodes:${graph.nodes.length} edges:${graph.edges.length}`;
		if (this.emitClick) {
			container.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_CLICK, { detail: { nodeId: "x", node: graph.nodes[0] }, bubbles: true, composed: true }));
		}
		return Promise.resolve();
	}
}

describe("shu-graph", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		if (!customElements.get("shu-graph")) customElements.define("shu-graph", ShuGraph);
	});

	it("renders through the injected renderer when products carry a TGraph", async () => {
		const el = document.createElement("shu-graph") as ShuGraph;
		const renderer = new RecordingRenderer();
		el.setRenderer(renderer);
		document.body.appendChild(el);
		const graph: TGraph = {
			nodes: [
				{ id: "a", label: "A" },
				{ id: "b", label: "B" },
			],
			edges: [{ from: "a", to: "b" }],
		};
		(el as ShuGraph & { products: Record<string, unknown> }).products = { graph };
		await Promise.resolve();
		await Promise.resolve();
		expect(renderer.calls.length).toBeGreaterThanOrEqual(1);
		const html = el.shadowRoot?.innerHTML ?? "";
		expect(html).toContain("nodes:2");
	});

	it("re-renders on subsequent products assignments", async () => {
		const el = document.createElement("shu-graph") as ShuGraph;
		const renderer = new RecordingRenderer();
		el.setRenderer(renderer);
		document.body.appendChild(el);
		(el as ShuGraph & { products: Record<string, unknown> }).products = { graph: { nodes: [{ id: "a", label: "A" }], edges: [] } };
		await Promise.resolve();
		await Promise.resolve();
		(el as ShuGraph & { products: Record<string, unknown> }).products = {
			graph: {
				nodes: [
					{ id: "a", label: "A" },
					{ id: "b", label: "B" },
				],
				edges: [],
			},
		};
		await Promise.resolve();
		await Promise.resolve();
		expect(renderer.calls.length).toBeGreaterThanOrEqual(2);
		expect(renderer.calls[renderer.calls.length - 1].graph.nodes.length).toBe(2);
	});

	it("re-dispatches graph-node-click out of the shadow boundary", async () => {
		const el = document.createElement("shu-graph") as ShuGraph;
		const renderer = new RecordingRenderer();
		renderer.emitClick = true;
		el.setRenderer(renderer);
		document.body.appendChild(el);
		const received: Array<{ nodeId: string }> = [];
		document.addEventListener(
			SHU_EVENT.GRAPH_NODE_CLICK as string,
			((e: CustomEvent) => {
				received.push(e.detail as { nodeId: string });
			}) as EventListener,
		);
		(el as ShuGraph & { products: Record<string, unknown> }).products = { graph: { nodes: [{ id: "a", label: "A" }], edges: [] } };
		await Promise.resolve();
		await Promise.resolve();
		expect(received.length).toBe(1);
		expect(received[0].nodeId).toBe("x");
	});

	it("throws when products lacks a TGraph (no silent failure)", () => {
		const el = document.createElement("shu-graph") as ShuGraph;
		document.body.appendChild(el);
		expect(() => {
			(el as ShuGraph & { products: Record<string, unknown> }).products = { foo: "bar" };
		}).toThrow();
	});
});
