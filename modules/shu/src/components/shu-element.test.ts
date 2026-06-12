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
import { describe, it, expect, beforeEach } from "vitest";
import { css, html, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { flushPersistWrites, readElementPrefs, writeElementPrefs } from "../element-prefs.js";
import { setJsonCookie } from "../cookies.js";

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

const P = z.object({ size: z.number().default(10), tone: z.string().default("plain"), volatile: z.string().default("") });

class PersistProbe extends ShuElement<typeof P> {
	static persistFields = ["size", "tone"] as const;
	key: string | null = "";
	constructor() {
		super(P, {});
	}
	protected override get persistKey(): string | null {
		return this.key;
	}
	set(partial: Partial<z.infer<typeof P>>): void {
		this.setState(partial);
	}
	get current(): z.infer<typeof P> {
		return this.state;
	}
	render(): TemplateResult {
		return html`<div></div>`;
	}
}
customElements.define("shu-persist-probe", PersistProbe);

describe("ShuElement persistFields", () => {
	beforeEach(() => {
		flushPersistWrites();
		setJsonCookie("shu-prefs-shu-persist-probe", {});
	});

	const attach = (key: string | null = ""): PersistProbe => {
		const el = new PersistProbe();
		el.key = key;
		document.body.appendChild(el);
		return el;
	};

	it("setState write-through persists declared fields; a fresh instance with the same key restores them", () => {
		const a = attach();
		a.set({ size: 42, tone: "warm", volatile: "not persisted" });
		flushPersistWrites();
		a.remove();
		const b = attach();
		expect(b.current.size).toBe(42);
		expect(b.current.tone).toBe("warm");
		expect(b.current.volatile).toBe("");
	});

	it("instances persist independently per persistKey", () => {
		const a = attach("one");
		a.set({ size: 1 });
		const b = attach("two");
		b.set({ size: 2 });
		flushPersistWrites();
		a.remove();
		b.remove();
		expect(attach("one").current.size).toBe(1);
		expect(attach("two").current.size).toBe(2);
	});

	it("a null persistKey neither persists nor restores", () => {
		writeElementPrefs("shu-persist-probe", "", { size: 99 });
		const el = attach(null);
		expect(el.current.size).toBe(10);
		el.set({ size: 5 });
		flushPersistWrites();
		expect(readElementPrefs("shu-persist-probe", "")).toEqual({ size: 99 });
	});

	it("a field set explicitly before attach is never overwritten by the remembered value; others restore", () => {
		writeElementPrefs("shu-persist-probe", "", { size: 7, tone: "cool" });
		const el = new PersistProbe();
		el.set({ size: 33 });
		document.body.appendChild(el);
		expect(el.current.size).toBe(33);
		expect(el.current.tone).toBe("cool");
	});

	it("an invalid remembered value is dropped whole rather than crashing or half-applying", () => {
		writeElementPrefs("shu-persist-probe", "", { size: "not-a-number", tone: "cool" });
		const el = attach();
		expect(el.current.size).toBe(10);
		expect(el.current.tone).toBe("plain");
	});

	it("a typo'd persistFields entry fails fast at construction", () => {
		const Bad = class extends ShuElement<typeof P> {
			static persistFields = ["nope"] as const;
			constructor() {
				super(P, {});
			}
			render(): TemplateResult {
				return html`<div></div>`;
			}
		};
		customElements.define("shu-persist-bad-probe", Bad);
		expect(() => new Bad()).toThrow(/persistFields names "nope"/);
	});

	it("evicts the oldest instance entries past the per-tag cap", () => {
		for (let i = 0; i < 30; i++) writeElementPrefs("shu-persist-probe", `k${i}`, { size: i });
		expect(readElementPrefs("shu-persist-probe", "k0")).toBeUndefined();
		expect(readElementPrefs("shu-persist-probe", "k29")).toEqual({ size: 29 });
	});
});
