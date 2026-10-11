/**
 * Provides a fake of the site's graph presenter for tests of a view that embeds one. `declareFakeGraphPresenter`
 * declares it as the site's "graph" presenter. The fake records what its host gives it, and reports a node a reader
 * opens as the presenter does. Every embedding view's test imports this one fake for the presenter boundary.
 */
import { declareSpec } from "./test/catalog-fixture.js";
import { vi } from "vitest";
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import type { TLinkedData } from "@haibun/core/lib/hypermedia.js";
import { presenterIn } from "./page/controllers/presenter-controller.js";
import type { TGraphPresenter, TPresenterNodeClick } from "./page/ports.js";
import { SHU_EVENT } from "./domains/elements.js";

export const FAKE_PRESENTER_TAG = "fake-graph-presenter";

export class FakeGraphPresenter extends HTMLElement implements TGraphPresenter {
	quads: TQuad[] = [];
	clusters: TCluster[] = [];
	selected: string | null = null;
	previewed: string[] | null = null;

	setQuads(quads: TQuad[], clusters: TCluster[] = []): void {
		this.quads = quads;
		this.clusters = clusters;
	}
	selectNode(id: string | null): void {
		this.selected = id;
	}
	previewNodes(ids: string[] | null): void {
		this.previewed = ids;
	}
	summarizeForContext(): TLinkedData | null {
		return { "@id": "view:fake-graph", subjects: [...new Set(this.quads.map((quad) => quad.subject))] };
	}
	/** Reports a reader opening a node to the host, as the presenter reports it. */
	openNode(nodeId: string): void {
		const detail: TPresenterNodeClick = { nodeId };
		this.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_CLICK, { detail, bubbles: true, composed: true }));
	}
}

/** Declares the fake as the site's graph presenter, beside the `types` and the `ui` entries a case gives, keyed by type or
 *  domain. The site's other declarations are empty. */
export function declareFakeGraphPresenter(ui: Record<string, Record<string, unknown>>, types: string[]): void {
	if (!customElements.get(FAKE_PRESENTER_TAG)) customElements.define(FAKE_PRESENTER_TAG, FakeGraphPresenter);
	declareSpec({ types, idFields: {}, rels: {}, edgeRanges: {}, queryable: {}, validTimeFields: {}, ui: { graph: { component: FAKE_PRESENTER_TAG, presents: "graph" }, ...ui } });
}

/** Returns the presenter a host holds in a slot once its mount has resolved. */
export async function mountedPresenter(host: HTMLElement, slot: string): Promise<FakeGraphPresenter> {
	return (await vi.waitUntil(() => presenterIn(host, slot))) as FakeGraphPresenter;
}
