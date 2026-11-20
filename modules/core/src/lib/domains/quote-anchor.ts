/**
 * Locating a quoted passage in a text, as a Web Annotation TextQuoteSelector states it: its exact words, and the words
 * before and after it that pick one occurrence where the words repeat.
 */

/** A range of a text, from `start` up to `end`. */
export type TTextRange = { readonly start: number; readonly end: number };

/** The refusal of a quote whose exact text is empty, which `indexOf` locates at the text's start. */
const EMPTY_QUOTE = "a quote's exact text is empty, so it doesn't locate a passage. Quote the passage's words";

/** Returns where each occurrence of `exact` is in `text`, in their order. */
export function quoteOccurrences(text: string, exact: string): TTextRange[] {
	if (exact === "") throw new Error(EMPTY_QUOTE);
	const found: TTextRange[] = [];
	for (let start = text.indexOf(exact); start >= 0; start = text.indexOf(exact, start + 1)) found.push({ start, end: start + exact.length });
	return found;
}

/** Locate a quote within a text, honouring an optional prefix/suffix to pick the right occurrence when the quote repeats.
 *  Null when the quote is not present: a reader anchors against the text it holds, so a quote that doesn't appear in it
 *  isn't located there. */
export function locateQuoteOffsets(text: string, exact: string, prefix?: string, suffix?: string): TTextRange | null {
	const located = quoteOccurrences(text, exact).find(
		({ start, end }) => (!prefix || text.slice(Math.max(0, start - prefix.length), start).endsWith(prefix)) && (!suffix || text.slice(end, end + suffix.length).startsWith(suffix)),
	);
	return located === undefined ? null : located;
}

/** Whether an anchor quotes its Body as the Body reads now: current where the digest it states is the Body's, and stale where the
 *  Body changed after the anchor quoted it. */
export const ANCHOR_STATE = { current: "current", stale: "stale" } as const;
export type TAnchorState = (typeof ANCHOR_STATE)[keyof typeof ANCHOR_STATE];

/** Returns the state of an anchor that states `stated` as its Body's digest, where the Body's digest is `held`. */
export const anchorStateOf = (stated: string, held: string): TAnchorState => (stated === held ? ANCHOR_STATE.current : ANCHOR_STATE.stale);
