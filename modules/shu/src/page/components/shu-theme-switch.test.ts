// @vitest-environment jsdom
/**
 * The theme and the scale a reader chooses are stored under `<shu-theme-switch>`'s tag, in its cookie, and a later page
 * applies them at its start, without reading `localStorage`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { SHU_TAG } from "../../domains/elements.js";
import { PREFERENCES_COOKIE_PREFIX } from "../adapters/prefs-cookie.js";
import { pagePreferences } from "../root.js";
import { endPage } from "../../page-pinned.js";
import { clearStoredFields } from "../../test-setup.js";
import { applyStoredTheme } from "./shu-theme-switch.js";

/** A page whose `localStorage` throws on each use, as a browser that refuses the site's storage does. */
function refusingLocalStorage(): () => void {
	const owned = Object.getOwnPropertyDescriptor(window, "localStorage");
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		get: () => {
			throw new DOMException("the site's storage is refused", "SecurityError");
		},
	});
	return () => owned && Object.defineProperty(window, "localStorage", owned);
}

const pressed = async (label: string): Promise<void> => {
	const control = document.createElement(SHU_TAG.THEME_SWITCH);
	document.body.appendChild(control);
	await (control as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
	const button = [...(control.shadowRoot?.querySelectorAll("button") ?? [])].find((b) => b.textContent === label);
	if (!button) throw new Error(`<shu-theme-switch> doesn't render a ${label} control`);
	button.click();
	control.remove();
};

describe("the theme and the scale a reader chooses", () => {
	afterEach(() => {
		clearStoredFields(SHU_TAG.THEME_SWITCH);
		document.documentElement.removeAttribute("data-theme");
		document.documentElement.style.removeProperty("--shu-scale");
	});

	it("are stored in <shu-theme-switch>'s cookie, and a later page whose localStorage throws applies them", async () => {
		await pressed("Dark");
		await pressed("XL");
		pagePreferences().flush();
		expect(document.cookie).toContain(`${PREFERENCES_COOKIE_PREFIX}${SHU_TAG.THEME_SWITCH}=`);
		expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

		endPage();
		document.documentElement.removeAttribute("data-theme");
		document.documentElement.style.removeProperty("--shu-scale");
		const restore = refusingLocalStorage();
		try {
			applyStoredTheme();
		} finally {
			restore();
		}
		expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
		expect(document.documentElement.style.getPropertyValue("--shu-scale")).toBe("1.5");
	});

	it("are the operating system's theme at the medium scale where the reader didn't choose them", () => {
		applyStoredTheme();
		expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
		expect(document.documentElement.style.getPropertyValue("--shu-scale")).toBe("1");
	});
});
