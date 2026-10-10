/**
 * The page's clipboard. The asynchronous Clipboard API is absent or refused in a page outside a secure context, such as a
 * report opened from `file://`, and there the adapter copies through `execCommand("copy")` on a hidden text area.
 */
import type { TClipboard } from "../ports.js";

/** Returns the clipboard of `page`. */
export function browserClipboard(page: Window): TClipboard {
	return {
		copy: async (text) => {
			if (page.navigator.clipboard?.writeText) {
				try {
					await page.navigator.clipboard.writeText(text);
					return true;
				} catch {
					// A page outside a secure context refuses the API, and copies through the text area below.
				}
			}
			const area = page.document.createElement("textarea");
			area.value = text;
			area.style.position = "fixed";
			area.style.opacity = "0";
			page.document.body.appendChild(area);
			area.select();
			try {
				return page.document.execCommand("copy");
			} finally {
				area.remove();
			}
		},
	};
}
