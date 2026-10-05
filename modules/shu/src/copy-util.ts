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
