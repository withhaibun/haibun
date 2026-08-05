// @vitest-environment jsdom
/**
 * A field NAMES its control: assistive tech announces the two together, and pressing the name acts on the control, as
 * pressing a label does. The control is slotted from the light DOM, so a <label for> cannot reach it — these pin the
 * association that does work.
 */
import { describe, it, expect, beforeEach } from "vitest";
import "./shu-field.js";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

async function field(label: string, control: HTMLElement, trailing = false): Promise<HTMLElement> {
	const el = document.createElement("shu-field");
	el.setAttribute("label", label);
	if (trailing) el.setAttribute("trailing", "");
	el.append(control);
	document.body.append(el);
	await flush();
	return el;
}

describe("shu-field names its control", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("gives the control the field's name as its accessible name", async () => {
		const box = document.createElement("input");
		box.type = "checkbox";
		await field("flatten", box, true);
		expect(box.getAttribute("aria-label")).toBe("flatten");
	});

	it("leaves a control that names itself alone", async () => {
		const select = document.createElement("select");
		select.setAttribute("aria-label", "its own name");
		await field("view", select);
		expect(select.getAttribute("aria-label")).toBe("its own name");
	});

	it("presses the control when the name is pressed, as a label does", async () => {
		const box = document.createElement("input");
		box.type = "checkbox";
		const el = await field("group", box);
		const name = el.shadowRoot?.querySelector(".name") as HTMLElement | null;
		if (!name) throw new Error("the field renders no name to press");
		name.click();
		expect(box.checked).toBe(true);
	});
});
