/**
 * The alignment of a rendered text with the stored text whose rendering it is. A view renders a Body's stored text, such as
 * markdown, into the text a reader reads, without the markup's syntax, and an anchor quotes the stored text: a quote's place in the
 * rendered text is where the rendered characters that the quoted stored characters render are, and a reader's selection in the
 * rendered text quotes the stored characters its characters render.
 *
 * Rendering keeps the order of the text's characters and drops the syntax around them, so each rendered character is matched with
 * the next stored character that equals it. A character the renderer writes, which the stored text doesn't hold at that place, is
 * matched as unmatched.
 */
import { locateQuoteOffsets, type TTextRange } from "@haibun/core/lib/domains/quote-anchor.js";
import type { TQuoteAnchor } from "@haibun/core/lib/domains/resources.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";

/** A stored text, the text it renders as, and, for each rendered character, the place of the stored character it renders, or
 *  `UNMATCHED` for a character the renderer writes. */
export type TTextAlignment = { readonly stored: string; readonly rendered: string; readonly storedAt: readonly number[] };

/** The stored place of a rendered character the renderer writes. */
const UNMATCHED = -1;

/** Returns the alignment of `rendered` with `stored`, the text a view rendered as `rendered`. */
export function alignTexts(stored: string, rendered: string): TTextAlignment {
	const storedAt: number[] = [];
	let next = 0;
	for (const character of rendered) {
		const at = stored.indexOf(character, next);
		for (let unit = 0; unit < character.length; unit++) storedAt.push(at < 0 ? UNMATCHED : at + unit);
		if (at >= 0) next = at + character.length;
	}
	return { stored, rendered, storedAt };
}

/** Returns the first place in `storedAt` from `from` whose matched stored place is at least `at`. Matched places rise along the
 *  rendered text, so a binary search over the rendered places finds it, stepping past each unmatched place. */
function firstRenderingFrom(storedAt: readonly number[], at: number): number {
	let [low, high] = [0, storedAt.length];
	while (low < high) {
		const middle = (low + high) >> 1;
		let probe = middle;
		while (probe < high && itemAt(storedAt, probe) === UNMATCHED) probe++;
		if (probe < high && itemAt(storedAt, probe) < at) low = probe + 1;
		else high = middle;
	}
	return low;
}

/** Returns the range of the rendered text that renders the stored range `range`, or null where the rendered text doesn't render a
 *  character of the range. */
export function renderedRange({ storedAt }: TTextAlignment, range: TTextRange): TTextRange | null {
	let start = firstRenderingFrom(storedAt, range.start);
	while (start < storedAt.length && itemAt(storedAt, start) === UNMATCHED) start++;
	if (start >= storedAt.length || itemAt(storedAt, start) >= range.end) return null;
	let end = firstRenderingFrom(storedAt, range.end);
	while (end > start && itemAt(storedAt, end - 1) === UNMATCHED) end--;
	return { start, end };
}

/** Returns the range of the stored text whose characters the rendered range `range` renders, or null where the range holds only
 *  characters the renderer writes. */
export function storedRange({ storedAt }: TTextAlignment, range: TTextRange): TTextRange | null {
	const matched = storedAt.slice(range.start, range.end).filter((at) => at !== UNMATCHED);
	const [first] = matched;
	return first === undefined ? null : { start: first, end: itemAt(matched, matched.length - 1) + 1 };
}

/** Returns where the rendered text reads a quote of the stored text: the quote located in the stored text, by its words around it
 *  where they pick one occurrence, then placed on the rendered text. Null where the stored text doesn't quote it. */
export function renderedQuote(alignment: TTextAlignment, quote: TQuoteAnchor): TTextRange | null {
	const at = locateQuoteOffsets(alignment.stored, quote.exact, quote.prefix, quote.suffix);
	return at === null ? null : renderedRange(alignment, at);
}
