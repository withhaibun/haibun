// @vitest-environment jsdom
/**
 * Regression guard for the lit finalize-via-observedAttributes contract.
 *
 * lit computes `elementStyles` lazily the first time its `static observedAttributes`
 * getter runs (`customElements.define` reads it). A subclass that overrode the getter
 * with a raw `return [...]` never called `super`, so `finalize()` never ran and the
 * component inherited the base class's empty `elementStyles` — every `static styles`
 * rule was silently dropped from the shadow root (no layout, no sizing, no resize
 * handle, no aria-pressed highlight). jsdom applies no CSS, so attribute-reflection
 * tests stayed green while the live UI was unstyled. This test pins the mechanism that
 * jsdom *can* see: declaring `observedHtmlAttributes` must still finalize styles.
 */
import { describe, it, expect } from "vitest";
import { css, html, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";

const S = z.object({ x: z.string().default("") });

class FinalizeProbe extends ShuElement<typeof S> {
	static observedHtmlAttributes = ["foo", "bar"];
	static styles = [shuBaseStyles, css`:host { color: var(--shu-fg); }`];
	constructor() { super(S, { x: "" }); }
	render(): TemplateResult { return html`<div></div>`; }
}
customElements.define("shu-finalize-probe", FinalizeProbe);

describe("ShuElement observedAttributes → finalize contract", () => {
	it("declared observedHtmlAttributes appear in observedAttributes (via super)", () => {
		expect(FinalizeProbe.observedAttributes).toEqual(expect.arrayContaining(["foo", "bar"]));
	});

	it("declaring attributes still triggers finalize so static styles are adopted (not inherited-empty)", () => {
		// Accessing observedAttributes is what the browser does at define() time; the base getter
		// calls super.observedAttributes, which runs finalize() and builds elementStyles on THIS class.
		void FinalizeProbe.observedAttributes;
		expect(Object.hasOwn(FinalizeProbe, "elementStyles")).toBe(true);
		const elementStyles = (FinalizeProbe as unknown as { elementStyles: unknown[] }).elementStyles;
		expect(elementStyles.length).toBe(2);
	});
});

class SealedOverrideProbe extends ShuElement<typeof S> {
	constructor() {
		super(S, { x: "" });
	}
	connectedCallback(): void {} // raw override of a sealed method — must throw at construction
	render(): TemplateResult {
		return html`<div></div>`;
	}
}
customElements.define("shu-sealed-override-probe", SealedOverrideProbe);

describe("ShuElement sealed-lifecycle guard", () => {
	it("throws at construction if a subclass overrides a sealed lifecycle method instead of the hook", () => {
		expect(() => new SealedOverrideProbe()).toThrow(/overrides sealed ShuElement\.connectedCallback\(\) — override protected onConnected/);
	});
});
