/**
 * Copies text to the clipboard. The async Clipboard API is unavailable or blocked in a non-secure context, such as a
 * serialized report opened from `file://`. The function then falls back to `execCommand("copy")` on a hidden textarea.
 * Returns whether the copy succeeded, so a caller can show the result.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		/* blocked in a non-secure context, such as file://: fall back below */
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
