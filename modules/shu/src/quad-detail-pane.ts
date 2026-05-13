/**
 * Shared seqPath utilities. The dedicated fact/quad pane was retired: typed-
 * fact subjects ARE the origin seqPath, so click-throughs from the graph view
 * and the step-detail pane now route to <shu-step-detail> via PaneState. This
 * module keeps the bracket-tolerant `parseSeqPath` (consumers feed it user-
 * facing strings like `"[0.1.2]"`) and `escHtml` for HTML escaping.
 */

export function escHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Parse seqPath number array from event ID like "[1.2.3]" or "1.2.3". Returns undefined for non-numeric IDs. */
export function parseSeqPath(id: string): number[] | undefined {
	const cleaned = id.replace(/^\[|\]$/g, "");
	if (!cleaned || cleaned.includes(" ")) return undefined;
	const parts = cleaned.split(".");
	const nums = parts.map(Number);
	return nums.length > 0 && nums.every((n) => Number.isFinite(n) && !Number.isNaN(n)) ? nums : undefined;
}
