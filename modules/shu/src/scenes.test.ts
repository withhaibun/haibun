// @vitest-environment jsdom
/**
 * Capture and apply — a scene holds exactly what a view remembers across a reload, and returning to one sets those
 * choices back through the view's ordinary state path.
 */
import { describe, it, expect } from "vitest";
import { html, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement } from "./components/shu-element.js";
import { applyScene, builtInScenes, captureScene, networkSceneTypes, storedAccessLevel, NETWORK_SCENE } from "./scenes.js";
import { setSiteMetadata, type SiteMetadata } from "./rels-cache.js";

const StateSchema = z.object({ overrides: z.record(z.string(), z.boolean()).default({}), limit: z.number().default(10), hovered: z.string().optional() });

class TestView extends ShuElement<typeof StateSchema> {
	static persistFields = ["overrides", "limit"] as const;
	announced = 0;
	constructor() {
		super(StateSchema, {});
	}
	summarizeForKihan() {
		return null;
	}
	render(): TemplateResult {
		return html`<span>${this.state.limit}</span>`;
	}
	set(partial: Partial<z.infer<typeof StateSchema>>) {
		this.setState(partial);
	}
	read() {
		return this.state;
	}
	override applySceneState(fields: Record<string, unknown>): void {
		super.applySceneState(fields);
		this.announced++;
	}
}
customElements.define("test-scene-view", TestView);

const mount = (): TestView => document.body.appendChild(new TestView());

describe("what a saved scene is stored at", () => {
	it("stores at the level the reader is looking at, when that is a level anything can be stored at", () => {
		expect(storedAccessLevel("private")).toBe("private");
		expect(storedAccessLevel("public")).toBe("public");
	});

	it("stores at no level at all when the reader is looking at everything, which nothing can be stored at", () => {
		// `all` relaxes the READ ceiling; saving under it wrote a record no schema accepts, and the save silently did nothing.
		expect(storedAccessLevel("all")).toBeUndefined();
	});
});

describe("scenes", () => {
	it("captures exactly the options a view remembers, and nothing it does not", () => {
		const view = mount();
		view.set({ overrides: { Email: false }, limit: 25, hovered: "Person" });
		expect(captureScene([view])).toEqual({ "test-scene-view": { overrides: { Email: false }, limit: 25 } });
	});

	it("returns a view to a scene, replacing what it holds rather than merging into it", () => {
		const view = mount();
		view.set({ overrides: { Email: false } });
		const scene = captureScene([view]);
		view.set({ overrides: { Email: true, Person: false, File: true }, limit: 99 });
		applyScene([view], scene);
		expect(view.read().overrides).toEqual({ Email: false });
		expect(view.read().limit).toBe(10);
	});

	it("lets a view announce that its choices were restored, as it announces every other change to them", () => {
		const view = mount();
		applyScene([view], captureScene([view]));
		expect(view.announced).toBe(1);
	});

	it("fails on a scene naming an option the view does not remember, rather than half-applying", () => {
		const view = mount();
		expect(() => applyScene([view], { "test-scene-view": { hovered: "Person" } })).toThrow(/does not remember/);
	});

	it("fails on a scene naming a view that is not on the page", () => {
		expect(() => applyScene([mount()], { "other-view": { limit: 5 } })).toThrow(/not on this page/);
	});
});

describe("the scene every deployment has", () => {
	/** A site that declares just enough: a request naming who performed it, a step naming what allowed it, and the
	 *  types those point at. Nothing here is a list of scene members; the scene reads the declarations. */
	const site = {
		types: ["HttpRequest", "Endpoint", "SeqPath", "Principal", "Comment", "Email", "Body"],
		idFields: {},
		rels: {
			HttpRequest: { performedBy: "performedBy", url: "identifier" },
			SeqPath: { allowedAction: "allowedAction", stepText: "content" },
			Principal: { publicKey: "publicKey" },
			Comment: { attributedTo: "attributedTo" },
			Email: { subject: "name" },
		},
		edgeRanges: { HttpRequest: { target: "Endpoint", hasBody: "Body" }, SeqPath: { performedBy: "Principal" } },
		properties: {},
		queryable: {},
		validTimeFields: {},
		summary: {},
		ui: {},
		propertyDefinitions: {
			performedBy: { iri: "prov:wasAssociatedWith", range: "iri" },
			allowedAction: { iri: "sec:allowedAction", range: "literal" },
			publicKey: { iri: "sec:publicKeyMultibase", range: "literal" },
			attributedTo: { iri: "prov:wasAttributedTo", range: "iri" },
			identifier: { iri: "dcterms:identifier", range: "literal" },
			content: { iri: "sio:content", range: "literal" },
			name: { iri: "schema:name", range: "literal" },
		},
	} as unknown as SiteMetadata;

	it("reads its types off the site's own declarations, and reaches what they point at", () => {
		setSiteMetadata(site);
		const types = networkSceneTypes();
		expect(types, "what declares who acted or what allowed it, and what those point at").toEqual(["Endpoint", "HttpRequest", "Principal", "SeqPath"]);
		expect(types, "a record merely attributed to someone is not part of the exchange").not.toContain("Comment");
		expect(types, "nor is what a record carries, as against who it came from and what it was aimed at").not.toContain("Body");
		expect(types, "nor is an ordinary record").not.toContain("Email");
	});

	it("is offered whether or not anything was ever saved, as the view and the types to show", () => {
		setSiteMetadata(site);
		const [scene] = builtInScenes();
		expect(scene.id).toBe(NETWORK_SCENE);
		expect(scene.state["shu-fisheye-graph-view"], "an exchange reads as a sequence").toEqual({ viewType: "sequence" });
		expect(scene.state["shu-graph-filter"], "the exchange shown and everything else hidden, so the scene is the exchange rather than the graph with it added").toEqual({
			overrides: { Endpoint: true, HttpRequest: true, Principal: true, SeqPath: true, Comment: false, Email: false, Body: false },
		});
	});

	it("says nothing where a site declares nothing of the kind", () => {
		setSiteMetadata({ ...site, types: ["Email"], rels: { Email: { subject: "name" } }, edgeRanges: {} } as unknown as SiteMetadata);
		expect(builtInScenes(), "a deployment with no exchange to show is offered no scene of one").toEqual([]);
	});
});
