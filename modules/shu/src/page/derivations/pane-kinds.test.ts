// @vitest-environment jsdom
import { ActionSchema } from "@haibun/core/lib/domains/actions.js";
import { StepMethodSchema } from "@haibun/core/lib/steps/domains/step-method.js";
import { describe, expect, it } from "vitest";
import type { TPart } from "@haibun/core/lib/domains/resources.js";
import { columnEntryOf, parseColEntry, PANE_KINDS, paneIdOf, seedView, updateView, type DesiredPane, type TPaneContext } from "./pane-kinds.js";

/** A context whose catalog doesn't declare a record component, and titles a component by its tag. */
const CONTEXT: TPaneContext = { recordComponent: () => undefined, componentTitle: (tag) => tag };

/** A pane of each kind an address names. The views picker opens from a step's products, so an address doesn't name it. */
const ADDRESSED: DesiredPane[] = [
	{ paneType: "component", tag: "shu-monitor-column", label: "shu-monitor-column" },
	{ paneType: "entity", persistedAs: "Email", id: "did:example:m-1" },
	{ paneType: "entity", persistedAs: "Email", id: "m-1", selector: { exact: "a quoted passage" } },
	{ paneType: "type", persistedAs: "Issuer" },
	{ paneType: "filter-eq", persistedAs: "Email", predicate: "from", value: "a@b" },
	{ paneType: "filter-prop", persistedAs: "Email", predicate: "folder" },
	{ paneType: "filter-incoming", persistedAs: "Email", subject: "m-1" },
	{ paneType: "thread", persistedAs: "Email", subject: "m-1" },
	{ paneType: "entity", persistedAs: "SeqPath", id: "1790000000000-1.0.1.2" },
	{ paneType: "step", method: StepMethodSchema.parse("GraphStepper-graphQuery") },
	{ paneType: "action", action: ActionSchema.parse("Read:public") },
];

describe("the kinds of pane", () => {
	it("round-trips each kind's address and column entry through its parse", () => {
		const kinds = new Set(ADDRESSED.map((d) => d.paneType));
		expect([...kinds].sort(), "every kind an address names has a case").toEqual(
			Object.keys(PANE_KINDS)
				.filter((k) => k !== "views-picker")
				.sort(),
		);
		for (const d of ADDRESSED) {
			const parsed = parseColEntry(columnEntryOf(d), CONTEXT);
			expect(parsed, columnEntryOf(d)).toEqual(d);
			expect(parsed === null ? undefined : paneIdOf(parsed)).toBe(paneIdOf(d));
		}
	});

	it("gives an open component pane's view the data a new request carries, and an open record's view the part it names", () => {
		const view = document.createElement("div") as HTMLElement & { products?: Record<string, unknown>; revealPart?: (part: TPart) => void };
		updateView({ paneType: "component", tag: "shu-affordances-panel", label: "A", data: { goals: [] } }, view);
		expect(view.products).toEqual({ goals: [] });
		const revealed: TPart[] = [];
		view.revealPart = (part) => revealed.push(part);
		updateView({ paneType: "entity", persistedAs: "Email", id: "m-1" }, view);
		updateView({ paneType: "entity", persistedAs: "Email", id: "m-1", selector: { exact: "here" } }, view);
		expect(revealed).toEqual([{ exact: "here" }]);
	});

	it("gives a new component pane's view its data before the view attaches, and doesn't give another kind's view data", () => {
		const view = document.createElement("div") as HTMLElement & { products?: Record<string, unknown> };
		seedView({ paneType: "type", persistedAs: "Issuer" }, view);
		expect(view.products).toBeUndefined();
		seedView({ paneType: "component", tag: "shu-affordances-panel", label: "A", data: { goals: [] } }, view);
		expect(view.products).toEqual({ goals: [] });
	});
});
