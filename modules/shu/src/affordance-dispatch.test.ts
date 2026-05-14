// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { dispatchAffordanceFromResponse } from "./affordance-dispatch.js";
import { PaneState } from "./pane-state.js";
import { HYPERMEDIA } from "@haibun/core/schema/protocol.js";
import { ShuElement } from "./components/shu-element.js";

describe("dispatchAffordanceFromResponse", () => {
	beforeEach(() => {
		PaneState.__resetForTests();
		document.body.innerHTML = "";
		ShuElement.offline = true;
		ShuElement.pushHash("#?");
		if (!customElements.get("shu-column-pane")) customElements.define("shu-column-pane", class extends HTMLElement {});
		if (!customElements.get("shu-column-strip")) {
			customElements.define(
				"shu-column-strip",
				class extends HTMLElement {
					get panes(): HTMLElement[] {
						return Array.from(this.querySelectorAll("shu-column-pane"));
					}
					addPane(p: HTMLElement) {
						this.appendChild(p);
					}
					activatePane(_i: number) {
						/* test stub */
					}
				},
			);
		}
		if (!customElements.get("shu-affordances-panel")) customElements.define("shu-affordances-panel", class extends HTMLElement {});
		const strip = document.createElement("shu-column-strip");
		document.body.appendChild(strip);
		// biome-ignore lint/suspicious/noExplicitAny: test-only — strip facade is narrower than real ShuColumnStrip.
		PaneState.init(strip as any);
	});

	const flush = async () => {
		for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => queueMicrotask(resolve));
	};

	it("opens a component pane in PaneState when products carry _component markers", async () => {
		const response = {
			forward: [{ method: "X-y", stepperName: "X", stepName: "y", inputDomains: [], outputDomains: [], readyToRun: true }],
			goals: [{ domain: "g", resolution: { finding: "satisfied", goal: "g", factIdentity: "f" } }],
			[HYPERMEDIA.TYPE]: "shu-affordances-panel",
			[HYPERMEDIA.COMPONENT]: "shu-affordances-panel",
			[HYPERMEDIA.SUMMARY]: "Affordances",
			id: "affordances",
			view: "affordances",
		};
		const action = dispatchAffordanceFromResponse(response);
		expect(action.kind).toBe("open-component");
		await flush();
		expect(PaneState.has("shu-affordances-panel")).toBe(true);
	});

	it("opens a monitor pane when products carry shu-monitor-column markers (regression: show monitor from affordances panel)", async () => {
		if (!customElements.get("shu-monitor-column")) customElements.define("shu-monitor-column", class extends HTMLElement {});
		const response = {
			[HYPERMEDIA.TYPE]: "shu-monitor-column",
			[HYPERMEDIA.COMPONENT]: "shu-monitor-column",
			[HYPERMEDIA.SUMMARY]: "Monitor",
			id: "shu-monitor-column",
			view: "shu-monitor-column",
		};
		const action = dispatchAffordanceFromResponse(response);
		expect(action.kind).toBe("open-component");
		await flush();
		expect(PaneState.has("shu-monitor-column")).toBe(true);
		const pane = document.querySelector("shu-column-pane") as HTMLElement | null;
		expect(pane?.dataset.columnKey).toBe("shu-monitor-column");
	});

	it("returns kind:none for an empty product (no markers) and opens no pane", async () => {
		const action = dispatchAffordanceFromResponse({});
		expect(action.kind).toBe("none");
		await flush();
		expect(PaneState.snapshot()).toHaveLength(0);
	});
});
