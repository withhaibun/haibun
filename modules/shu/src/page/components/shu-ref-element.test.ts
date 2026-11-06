// @vitest-environment jsdom
/** A reference lit reuses for another record shows that record: its text and its address follow the attributes. */
import { describe, expect, it } from "vitest";
import { render } from "lit";
import { ICON_STEP_COMPLETED } from "@haibun/core/lib/domains/protocol.js";
import { passedStatementTpl, recordRef } from "./shu-ref.js";
import "./shu-ref-element.js";
import type { ShuRef } from "./shu-ref-element.js";

describe("<shu-ref>", () => {
	it("shows the record its attributes name now, after lit binds it to another", async () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		render(recordRef({ persistedAs: "Task", id: "t1" }, "the first"), host);
		render(recordRef({ persistedAs: "Task", id: "t2" }, "the second"), host);
		const ref = host.querySelector("shu-ref") as ShuRef | null;
		if (ref === null) throw new Error("the template doesn't render a reference");
		await ref.updateComplete;
		const shown = ref.shadowRoot;
		expect(shown?.querySelector("code")?.textContent).toBe("the second");
		expect(shown?.querySelector("a")?.getAttribute("href")).toContain("t2");
	});

	it("passedStatementTpl formats CHECK_YES with statement and links method and path", () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		render(passedStatementTpl("Renew permit", { method: "Permits-renewPermit", path: [0, 1, 0, 5], testId: "test-passed" }), host);
		const span = host.querySelector('[data-testid="test-passed"]');
		expect(span).not.toBeNull();
		expect(span?.textContent).toContain(ICON_STEP_COMPLETED);
		expect(span?.textContent).toContain("Renew permit");
		expect(span?.textContent).not.toContain("succeeded");
		const ref = span?.querySelector("shu-ref");
		expect(ref).not.toBeNull();
		expect(ref?.getAttribute("kind")).toBe("step");
	});
});
