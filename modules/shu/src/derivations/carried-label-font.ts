/**
 * The font a report carries for its labels: the label font as a data URL, and the characters it lacks as a pattern. A report opens from
 * a file, where the address a site serves the font at doesn't resolve and troika's lookup of a character the font lacks has
 * only its font service to read, so the report carries the font and draws a character it lacks as the replacement character.
 */
import type { TCarriedLabelFont } from "../domains/hydration.js";

/** The media type of the label font, a WOFF. */
const WOFF = "font/woff";

/** One range of a CSS `unicode-range`: a code point, or a first and last code point, in hexadecimal after `U+`. */
const RANGE = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i;

/** Returns each range of `unicodeRange`, a CSS `unicode-range`, from its first code point to its last. Throws for a range that
 *  isn't a code point or a first and last code point. */
export function codePointRanges(unicodeRange: string): [number, number][] {
	return unicodeRange.split(",").map((range) => {
		const matched = RANGE.exec(range.trim());
		const first = matched?.[1];
		if (first === undefined) throw new Error(`"${range}" in the label font's unicode-range isn't U+ and a code point or a first and last code point`);
		// A range of one code point states it alone.
		const last = matched?.[2] === undefined ? first : matched[2];
		return [Number.parseInt(first, 16), Number.parseInt(last, 16)];
	});
}

/** The flags of the pattern of the characters a carried font lacks: every match, by code point. */
export const UNCOVERED_FLAGS = "gu";

/** The replacement character, which the label font covers, for a character it lacks. */
const REPLACEMENT = "\uFFFD";

/** Returns `content` with each character `uncovered` matches as the replacement character. troika then finds every
 *  character of the text in the carried font, and doesn't read its font service for a character the font lacks. */
export const coveredText = (content: string, uncovered: RegExp): string => content.replace(uncovered, REPLACEMENT);

/** Returns the font a report carries: `font`, the label font, as a data URL, and the source of a pattern that matches each
 *  character outside the code points `unicodeRange` names. */
export function carriedLabelFont(font: ArrayBuffer, unicodeRange: string): TCarriedLabelFont {
	const covered = codePointRanges(unicodeRange).map(([first, last]) => `\\u{${first.toString(16)}}-\\u{${last.toString(16)}}`);
	return { font: `data:${WOFF};base64,${Buffer.from(font).toString("base64")}`, uncovered: `[^${covered.join("")}]` };
}
