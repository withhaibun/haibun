// @vitest-environment jsdom
/** A reference lit reuses for another record shows that record: its text and its address follow the attributes. */
import { describe, expect, it } from "vitest";
import { render } from "lit";
import { recordRef } from "./shu-ref.js";
import "./shu-ref-element.js";
import type { ShuRef } from "./shu-ref-element.js";

describe("<shu-ref>", () => {
	it("shows the record its attributes name now, after lit binds it to another", async () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		render(recordRef("Task", "t1", "the first"), host);
		render(recordRef("Task", "t2", "the second"), host);
		const ref = host.querySelector("shu-ref") as ShuRef | null;
		if (ref === null) throw new Error("the template doesn't render a reference");
		await ref.updateComplete;
		const shown = ref.shadowRoot;
		expect(shown?.querySelector("code")?.textContent).toBe("the second");
		expect(shown?.querySelector("a")?.getAttribute("href")).toContain("t2");
	});
});
