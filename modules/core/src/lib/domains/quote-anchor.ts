/**
 * Locating a quoted passage in a text, as a Web Annotation TextQuoteSelector states it: its exact words, and the words
 * before and after it that pick one occurrence where the words repeat.
 */

/** Locate a quote within a text, honouring an optional prefix/suffix to pick the right occurrence when the quote repeats.
 *  Null when the quote is not present: a reader anchors against the text it holds, so a quote that doesn't appear in it
 *  isn't located there. */
export function locateQuoteOffsets(text: string, exact: string, prefix?: string, suffix?: string): { start: number; end: number } | null {
	let from = 0;
	for (;;) {
		const idx = text.indexOf(exact, from);
		if (idx < 0) return null;
		const okPrefix = !prefix || text.slice(Math.max(0, idx - prefix.length), idx).endsWith(prefix);
		const okSuffix = !suffix || text.slice(idx + exact.length, idx + exact.length + suffix.length).startsWith(suffix);
		if (okPrefix && okSuffix) return { start: idx, end: idx + exact.length };
		from = idx + 1;
	}
}
