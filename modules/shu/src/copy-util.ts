const copyRegistry: string[] = [];

/** Register text for copy and return an index. */
export function registerCopyText(text: string): number {
	const idx = copyRegistry.length;
	copyRegistry.push(text);
	return idx;
}

/**
 * Copy text to the clipboard. The async Clipboard API is unavailable or blocked in non-secure contexts : a
 * serialized report opened from `file://` \u2014 so fall back to a hidden-textarea `execCommand("copy")`. Returns whether
 * the copy succeeded so callers can show a result instead of failing silently.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		/* blocked (e.g. file://) \u2014 fall back below */
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}

/** Bind copy-to-clipboard on elements with data-copy-idx attribute. */
export function bindCopyButtons(root: Element | ShadowRoot): void {
	root.querySelectorAll(".copy-btn[data-copy-idx]").forEach((btn) => {
		btn.addEventListener("click", async () => {
			const idx = parseInt((btn as HTMLElement).dataset.copyIdx ?? "", 10);
			const text = copyRegistry[idx] ?? "";
			if (!text) return;
			const ok = await copyText(text);
			btn.classList.toggle("copied", ok);
			(btn as HTMLElement).textContent = ok ? "\u2705" : "\u274c"; // \u2705 / \u274c \u2014 a visible result, never a silent no-op
			setTimeout(() => {
				btn.classList.remove("copied");
				(btn as HTMLElement).textContent = "\u{1f4cb}";
			}, 1500);
		});
	});
}

/** Create a copy button for the given text. Registers the text and returns button HTML. */
export function copyButtonHtml(text: string): string {
	const idx = registerCopyText(text);
	return `<button class="copy-btn" data-copy-idx="${idx}" title="Copy to clipboard">\u{1f4cb}</button>`;
}
