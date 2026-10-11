// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "./shu-refusal.js"; // the module defines the element
import type { ShuRefusal } from "./shu-refusal.js";
import { installRemedies } from "../root.js";
import { newPage } from "../../test/setup.js";
import { SHU_TAG } from "../../domains/elements.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import type { TPageRefusal } from "../domains/refusal.js";

/** A refusal view showing `refusal`, given `readAgain`. */
async function shown(refusal: TPageRefusal, readAgain?: () => void): Promise<ShuRefusal> {
	const view = document.createElement(SHU_TAG.REFUSAL) as ShuRefusal;
	view.refusal = refusal;
	view.readAgain = readAgain;
	document.body.appendChild(view);
	await view.updateComplete;
	return view;
}
const remedyOf = (view: ShuRefusal): HTMLElement | null => view.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.REFUSAL.REMEDY}"]`) ?? null;

describe("<shu-refusal>", () => {
	let reloads = 0;
	beforeEach(() => {
		newPage();
		reloads = 0;
		installRemedies({ reloadPage: () => reloads++ });
	});
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("shows the cause alone for a refusal without a remedy", async () => {
		const view = await shown({ error: "the record isn't held here" });
		expect(view.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.REFUSAL.CAUSE}"]`)?.textContent).toBe("the record isn't held here");
		expect(remedyOf(view)).toBeNull();
	});

	it("offers a sign-in as a link to where the reader signs in", async () => {
		const remedy = remedyOf(await shown({ error: "sign in first", remedy: { do: "sign-in", at: "https://example.org/sign-in" } }));
		expect(remedy?.tagName).toBe("A");
		expect(remedy?.getAttribute("href")).toBe("https://example.org/sign-in");
	});

	it("offers a reload as a button that reloads the page through its remedies port", async () => {
		const remedy = remedyOf(await shown({ error: "the client is older", remedy: { do: "reload", what: "client" } }));
		expect(remedy?.tagName).toBe("BUTTON");
		remedy?.click();
		expect(reloads).toBe(1);
	});

	it("offers a read again as a button that reads again, and throws where the view isn't given the read", async () => {
		let read = 0;
		const remedy = remedyOf(await shown({ error: "the site didn't respond", remedy: { do: "read-again" } }, () => read++));
		expect(remedy?.tagName).toBe("BUTTON");
		remedy?.click();
		expect(read).toBe(1);
		const view = document.createElement(SHU_TAG.REFUSAL) as ShuRefusal;
		view.refusal = { error: "the site didn't respond", remedy: { do: "read-again" } };
		expect(() => (view as unknown as { render(): unknown }).render()).toThrow("<shu-refusal> offers a read again, and isn't given the read");
	});

	it("offers a reference as a link to what it names", async () => {
		const remedy = remedyOf(await shown({ error: "read the type first", remedy: { do: "open", ref: { kind: "domain", target: { domain: "Email" } } } }));
		expect(remedy?.tagName).toBe("A");
		expect(remedy?.getAttribute("href")).toBe("#?col=type%3AEmail");
		expect(remedy?.textContent).toBe("Open Email");
	});
});
