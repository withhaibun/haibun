const copyRegistry: string[] = [];

/** Register text for copy and return an index. */
export function registerCopyText(text: string): number {
	const idx = copyRegistry.length;
	copyRegistry.push(text);
	return idx;
}

/** Bind copy-to-clipboard on elements with data-copy-idx attribute. */
export function bindCopyButtons(root: Element | ShadowRoot): void {
	root.querySelectorAll(".copy-btn[data-copy-idx]").forEach((btn) => {
		btn.addEventListener("click", async () => {
			const idx = parseInt((btn as HTMLElement).dataset.copyIdx ?? "", 10);
			const text = copyRegistry[idx] ?? "";
			if (!text) return;
			await navigator.clipboard.writeText(text);
			btn.classList.add("copied");
			(btn as HTMLElement).textContent = "\u2705";
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
