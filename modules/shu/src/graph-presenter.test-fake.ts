/**
 * The site's graph presenter as a view that embeds one meets it in a test: declared as the site's "graph" presenter,
 * recording what its host gives it, and reporting a node a reader opens as the presenter does. The one fake for the
 * presenter boundary, shared by every embedding view's test.
 */
import { vi } from "vitest";
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import type { TLinkedData } from "@haibun/core/lib/hypermedia.js";
import { setSiteMetadata } from "./rels-cache.js";
import { presenterIn, type TGraphPresenter, type TPresenterNodeClick } from "./graph-presenter.js";
import { SHU_EVENT } from "./consts.js";

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
	summarizeForKihan(): TLinkedData | null {
		return { "@id": "view:fake-graph", subjects: [...new Set(this.quads.map((quad) => quad.subject))] };
	}
	/** A reader opening a node, reported to the host as the presenter reports it. */
	openNode(nodeId: string): void {
		const detail: TPresenterNodeClick = { nodeId };
		this.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_CLICK, { detail, bubbles: true, composed: true }));
	}
}

/** Declare the fake as the site's graph presenter, in a site whose other declarations are empty but for the `ui` a case
 *  gives, by domain. */
export function declareFakeGraphPresenter(ui: Record<string, Record<string, unknown>> = {}): void {
	if (!customElements.get(FAKE_PRESENTER_TAG)) customElements.define(FAKE_PRESENTER_TAG, FakeGraphPresenter);
	setSiteMetadata({
		types: [],
		idFields: {},
		rels: {},
		edgeRanges: {},
		properties: {},
		queryable: {},
		validTimeFields: {},
		summary: {},
		ui: { graph: { component: FAKE_PRESENTER_TAG, presents: "graph" }, ...ui },
		propertyDefinitions: {},
	});
}

/** The presenter a host holds in a slot, once its mount has resolved. */
export async function mountedPresenter(host: HTMLElement, slot: string): Promise<FakeGraphPresenter> {
	return (await vi.waitUntil(() => presenterIn(host, slot))) as FakeGraphPresenter;
}
