/**
 * Shared seqPath utilities. A typed-fact subject IS its origin seqPath, so
 * click-throughs from the graph view and the step-detail pane route to
 * <shu-step-detail> via PaneState. `parseSeqPath` is bracket-tolerant, since
 * consumers feed it display strings like `"[0.1.2]"`.
 */

/** Parse seqPath number array from event ID like "[1.2.3]" or "1.2.3". Returns undefined for non-numeric IDs. */
export function parseSeqPath(id: string): number[] | undefined {
	const cleaned = id.replace(/^\[|\]$/g, "");
	if (!cleaned || cleaned.includes(" ")) return undefined;
	const parts = cleaned.split(".");
	const nums = parts.map(Number);
	return nums.length > 0 && nums.every((n) => Number.isFinite(n) && !Number.isNaN(n)) ? nums : undefined;
}
