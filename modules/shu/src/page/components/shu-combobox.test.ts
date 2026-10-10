// @vitest-environment jsdom
/**
 * The combobox offers its options and holds the one a reader picks. A press offers them, whether or not the control
 * already holds focus, and the control shows what it holds: the text its holder states, else the chosen option's label.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuCombobox } from "./shu-combobox.js";
import { installTestMediaQueries, manualClock } from "../../test-setup.js";
import { installClock } from "../root.js";
import { endPage } from "../adapters/page-held.js";

const OPTIONS = [
	{ value: "email-domain", label: "Email" },
	{ value: "file-domain", label: "File" },
];

type TCombobox = ShuCombobox & { updateComplete: Promise<unknown>; options: typeof OPTIONS; value: string; shown: string };

async function aCombobox(): Promise<TCombobox> {
	document.body.innerHTML = "";
	const combo = new ShuCombobox() as TCombobox;
	document.body.append(combo);
	await combo.updateComplete;
	combo.options = OPTIONS;
	combo.value = "email-domain";
	await combo.updateComplete;
	return combo;
}

const input = (combo: TCombobox): HTMLInputElement => {
	const found = combo.shadowRoot?.querySelector<HTMLInputElement>(".combo-input");
	if (!found) throw new Error("the combobox rendered no input");
	return found;
};

/** The options the control is offering, as the list it renders into the page holds them. */
const offered = (): string[] =>
	// The option the control holds carries a mark, which is not part of what it is called.
	Array.from(document.querySelectorAll<HTMLElement>('ul[role="listbox"] li')).map((item) => (item.textContent?.trim() ?? "").replace("✓", ""));

describe("the combobox", () => {
	beforeEach(() => {
		installTestMediaQueries();
	});
	afterEach(() => endPage());

	it("puts its list away 150 ms after the input loses focus, on the page's clock", async () => {
		const time = manualClock(0);
		installClock(time.clock);
		const combo = await aCombobox();
		input(combo).dispatchEvent(new FocusEvent("focus"));
		input(combo).dispatchEvent(new FocusEvent("blur"));
		time.advance(149);
		expect(offered(), "the list waits for a click on an option").toEqual(["Email", "File"]);
		time.advance(1);
		expect(offered(), "and is put away once the delay passes").toEqual([]);
	});

	it("offers its options on a press after a pick, since a pick leaves the control holding focus", async () => {
		const combo = await aCombobox();
		input(combo).dispatchEvent(new FocusEvent("focus"));
		expect(offered(), "the reader is offered every option").toEqual(["Email", "File"]);
		const file = Array.from(document.querySelectorAll<HTMLElement>('ul[role="listbox"] li')).find((item) => item.textContent?.includes("File"));
		file?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		await combo.updateComplete;
		expect(combo.value, "the option the reader picked").toBe("file-domain");
		expect(offered(), "and the list is put away").toEqual([]);
		input(combo).dispatchEvent(new Event("pointerdown"));
		expect(offered(), "a press offers them again, where the control doesn't raise focus").toEqual(["Email", "File"]);
	});

	it("shows the text its holder states for what it holds, and the chosen option's label where its holder doesn't state one", async () => {
		const combo = await aCombobox();
		expect(input(combo).value, "the chosen option").toBe("Email");
		combo.shown = "Email: 3";
		await combo.updateComplete;
		expect(input(combo).value, "what its holder states").toBe("Email: 3");
		combo.value = "file-domain";
		await combo.updateComplete;
		expect(input(combo).value, "which stands until its holder states another").toBe("Email: 3");
	});
});
