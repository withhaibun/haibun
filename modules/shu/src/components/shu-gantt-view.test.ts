// @vitest-environment jsdom
// shu-gantt-view's paint path in isolation: external task quads must render as gantt bars in the shadow DOM,
// and a graph with no gantt-typed property must fall to the empty state. Caught here rather than only in an e2e.
import { describe, it, expect, beforeEach } from "vitest";
import { ShuGanttView } from "./shu-gantt-view.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

const q = (subject: string, predicate: string, object: unknown): TQuad => ({ subject, predicate, object, namedGraph: "Task", timestamp: 1 }) as TQuad;
type View = ShuGanttView & { setQuads: (q: TQuad[]) => void; updateComplete: Promise<unknown> };

const mount = (): View => {
	const el = document.createElement("shu-gantt-view") as unknown as View;
	el.setAttribute("data-source", "external"); // external mount: no RPC snapshot, no live-event subscription
	document.body.appendChild(el);
	return el;
};

describe("shu-gantt-view paints task quads (jsdom)", () => {
	beforeEach(() => {
		if (!customElements.get("shu-gantt-view")) customElements.define("shu-gantt-view", ShuGanttView);
	});

	it("renders one gantt-task bar per task-like node, plus the dependency arrow", async () => {
		const el = mount();
		el.setQuads([
			q("t1", LinkRelations.STARTED_AT_TIME.rel, "2026-01-01"),
			q("t1", LinkRelations.ENDED_AT_TIME.rel, "2026-01-05"),
			q("t2", LinkRelations.STARTED_AT_TIME.rel, "2026-01-05"),
			q("t2", LinkRelations.ENDED_AT_TIME.rel, "2026-01-10"),
			q("t2", LinkRelations.DEPENDS_ON.rel, "t1"),
		]);
		await el.updateComplete;
		expect(el.shadowRoot?.querySelectorAll("g.gantt-task").length).toBe(2);
		expect(el.shadowRoot?.querySelector(".diagram-container")?.innerHTML ?? "").toContain('data-from="t1" data-to="t2"');
	});

	it("falls to the empty state when no node carries a gantt-typed property", async () => {
		const el = mount();
		el.setQuads([q("x", "name", "Not a task")]);
		await el.updateComplete;
		expect(el.shadowRoot?.querySelector(".empty")?.textContent).toContain("No scheduled tasks");
	});
});
