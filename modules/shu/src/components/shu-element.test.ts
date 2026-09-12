// @vitest-environment jsdom
/**
 * Regression guard for the lit finalize-via-observedAttributes contract.
 *
 * lit computes `elementStyles` lazily the first time its `static observedAttributes`
 * getter runs (`customElements.define` reads it). A subclass that overrode the getter
 * with a raw `return [...]` never called `super`, so `finalize()` never ran and the
 * component inherited the base class's empty `elementStyles`: every `static styles`
 * rule was silently dropped from the shadow root (no layout, no sizing, no resize
 * handle, no aria-pressed highlight). jsdom applies no CSS, so attribute-reflection
 * tests stayed green while the live UI was unstyled. This test pins the mechanism that
 * jsdom *can* see: declaring `observedHtmlAttributes` must still finalize styles.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { css, html, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { ShuColumnPane } from "./shu-column-pane.js";
import { installTestMediaQueries } from "../test-setup.js";
import { shuBaseStyles } from "./styles.js";
import { flushPersistWrites, readElementPrefs, writeElementPrefs } from "../element-prefs.js";
import { setJsonCookie } from "../cookies.js";

const S = z.object({ x: z.string().default("") });

class FinalizeProbe extends ShuElement<typeof S> {
	summarizeForKihan() {
		return null;
	}

	static observedHtmlAttributes = ["foo", "bar"];
	static styles = [shuBaseStyles, css`:host { color: var(--shu-fg); }`];
	constructor() {
		super(S, { x: "" });
	}
	render(): TemplateResult {
		return html`<div></div>`;
	}
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
	summarizeForKihan() {
		return null;
	}

	constructor() {
		super(S, { x: "" });
	}
	connectedCallback(): void {} // raw override of a sealed method, must throw at construction
	render(): TemplateResult {
		return html`<div></div>`;
	}
}
customElements.define("shu-sealed-override-probe", SealedOverrideProbe);

describe("ShuElement sealed-lifecycle guard", () => {
	it("throws at construction if a subclass overrides a sealed lifecycle method instead of the hook", () => {
		expect(() => new SealedOverrideProbe()).toThrow(/overrides sealed ShuElement\.connectedCallback\(\), override protected onConnected/);
	});
});

const P = z.object({ size: z.number().default(10), tone: z.string().default("plain"), volatile: z.string().default("") });

class PersistProbe extends ShuElement<typeof P> {
	summarizeForKihan() {
		return null;
	}

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
			summarizeForKihan() {
				return null;
			}

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

/**
 * An invalid state write is a caller error, and the console is where it lands. A bare ZodError names the failing field
 * and nothing else, not the element, not the write, not the attribute that drove it, and setState is re-entrant
 * (state → attribute → attributeChangedCallback → setState), so the stack does not say either.
 */
describe("ShuElement invalid state reporting", () => {
	const Schema = z.object({ label: z.string(), count: z.number().default(0) });

	class ReportProbe extends ShuElement<typeof Schema> {
		summarizeForKihan() {
			return null;
		}

		// A number-bound attribute: a non-numeric attribute value coerces to NaN, which the schema rejects: the one way to
		// drive a rejected write in through attributeChangedCallback.
		static attributeFields = { "data-count": "count", "data-label": "label" };
		constructor() {
			super(Schema, { label: "start" });
		}
		render(): TemplateResult {
			return html`<span>${this.state.label}</span>`;
		}
		write(partial: Partial<z.infer<typeof Schema>>): void {
			this.setState(partial);
		}
		read(): z.infer<typeof Schema> {
			return this.state;
		}
	}
	if (!customElements.get("shu-report-probe")) customElements.define("shu-report-probe", ReportProbe);

	const probe = (): ReportProbe => document.createElement("shu-report-probe") as ReportProbe;

	it("names the element, the write, and the offending value, and keeps the original error as the cause", () => {
		let thrown: Error | undefined;
		try {
			probe().write({ label: undefined as unknown as string });
		} catch (e) {
			thrown = e as Error;
		}
		expect(thrown?.message).toContain("<shu-report-probe>");
		expect(thrown?.message).toContain("label: undefined");
		expect(thrown?.message).toContain("at label"); // zod's own account of the failure, kept
		expect((thrown?.cause as z.ZodError)?.issues?.[0]?.path).toEqual(["label"]);
	});

	it("reports the value that failed, not just the field name", () => {
		expect(() => probe().write({ count: "seven" as unknown as number })).toThrow(/count: "seven"/);
	});

	it("cuts a long value rather than flooding the console with it", () => {
		let thrown: Error | undefined;
		try {
			probe().write({ count: "x".repeat(500) as unknown as number });
		} catch (e) {
			thrown = e as Error;
		}
		expect(thrown?.message).toContain("…");
		expect(thrown?.message.length).toBeLessThan(300);
	});

	// Driven through attributeChangedCallback: the reaction the browser invokes on an attribute write. jsdom does not
	// enqueue custom-element reactions for setAttribute, so calling it is what a real attribute change does here.
	it("names the attribute that drove a rejected write, since setState only sees the state it was handed", () => {
		let thrown: Error | undefined;
		try {
			probe().attributeChangedCallback("data-count", null, "seven");
		} catch (e) {
			thrown = e as Error;
		}
		expect(thrown?.message).toContain('attribute data-count="seven"');
		expect(thrown?.message).toContain("state.count");
		expect(thrown?.message).toContain("<shu-report-probe>"); // the setState account rides along
	});

	// A state→attribute write removes the attribute when the value is empty, and the browser reports that removal back.
	// Reading it as "no value" would reject a field the element must hold, the loop a boot-time attribute write fell into.
	it("leaves a field that must have a value alone when its attribute is removed, since an absent attribute says nothing", () => {
		const el = probe();
		el.write({ label: "a name" });
		expect(() => el.attributeChangedCallback("data-label", "a name", null)).not.toThrow();
		expect(el.read().label).toBe("a name");
	});
});

describe("knowing whether the hosting column is collapsed", () => {
	// Ambient, at any depth: this is what the pane→column→scroller threading replaced, which could not reach a view
	// nested inside another view's shadow root at all.
	const EmptySchema = z.object({});

	class Deep extends ShuElement<typeof EmptySchema> {
		summarizeForKihan(): TLinkedData | null {
			return null;
		}
		constructor() {
			super(EmptySchema, {});
		}
		get collapsed(): boolean {
			return this.columnCollapsed;
		}
		render() {
			return html``;
		}
	}
	class Wrapper extends ShuElement<typeof EmptySchema> {
		summarizeForKihan(): TLinkedData | null {
			return null;
		}
		constructor() {
			super(EmptySchema, {});
		}
		render() {
			return html`<shu-deep-probe></shu-deep-probe>`;
		}
	}

	beforeAll(() => {
		installTestMediaQueries();
		if (!customElements.get("shu-deep-probe")) customElements.define("shu-deep-probe", Deep);
		if (!customElements.get("shu-wrapper-probe")) customElements.define("shu-wrapper-probe", Wrapper);
		if (!customElements.get("shu-column-pane")) customElements.define("shu-column-pane", ShuColumnPane);
	});

	const mounted = async (): Promise<{ pane: ShuColumnPane; deep: Deep }> => {
		document.body.innerHTML = "";
		const pane = document.createElement("shu-column-pane") as ShuColumnPane;
		pane.setAttribute("label", "A");
		pane.dataset.columnKey = "a";
		const wrapper = document.createElement("shu-wrapper-probe") as Wrapper;
		pane.appendChild(wrapper);
		document.body.appendChild(pane);
		await pane.updateComplete;
		await wrapper.updateComplete;
		const deep = wrapper.shadowRoot?.querySelector("shu-deep-probe") as Deep;
		await deep.updateComplete;
		return { pane, deep };
	};

	it("reaches a view nested inside another view's shadow root", async () => {
		const { pane, deep } = await mounted();
		expect(deep.collapsed, "open to begin with").toBe(false);
		pane.setMinimized(true);
		await deep.updateComplete;
		expect(deep.collapsed, "and told when its column becomes a strip, with nothing passing it down").toBe(true);
	});

	it("follows the column back open", async () => {
		const { pane, deep } = await mounted();
		pane.setMinimized(true);
		await deep.updateComplete;
		pane.setMinimized(false);
		await deep.updateComplete;
		expect(deep.collapsed).toBe(false);
	});

	it("says open for a view in no column at all, rather than throwing", async () => {
		document.body.innerHTML = "";
		const loose = document.createElement("shu-deep-probe") as Deep;
		document.body.appendChild(loose);
		await loose.updateComplete;
		expect(loose.collapsed).toBe(false);
	});
});
