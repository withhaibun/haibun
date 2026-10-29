/**
 * The responses to troika's lookup of fallback fonts, for a label character the label font lacks. troika requests from a
 * resolver the font that covers each such character: an index of a range of code points, the metadata of the font the
 * index names, and that font's file. shu's index names its math font for the symbols of DL notation, which the label font
 * lacks, and leaves every other character uncovered, which the resolver reads as the font named `latin`; shu serves its label
 * font as that font, so another character the label font lacks draws as the font's missing glyph. The page doesn't read a font
 * service (CA3D10), and doesn't read the math font before a label holds a DL symbol.
 */
import { DL_SYMBOL } from "@haibun/core/lib/records/domains/axioms.js";

/** The fonts the resolver names: the label font, where an index leaves a character uncovered, and the math font. */
export const FALLBACK_FONT = { label: "latin", math: "math" } as const;
export type TFallbackFont = (typeof FALLBACK_FONT)[keyof typeof FALLBACK_FONT];

/** The resolver's data schema version, which it checks on every response. */
const SCHEMA_VERSION = 1;

/** The category, style and weight of each served fallback font. */
const TYPEFORM = { category: "sans-serif", style: "normal", weight: 400 } as const;

/** The code points of an index: a range of 256, which the resolver names by its first and last, in hex. */
const INDEX_SIZE = 256;
/** The bits each character of an index's coverage holds, above its base. */
const COVERAGE = { bits: 6, base: 48 } as const;

/** The code points the math font covers for the labels: the symbols of DL notation. */
export const MATH_CODE_POINTS: readonly number[] = Object.values(DL_SYMBOL).map((symbol) => {
	const point = symbol.codePointAt(0);
	if (point === undefined) throw new Error("a DL symbol is empty");
	return point;
});

/** The coverage of `points` within the index that starts at `start`, as the resolver reads it: a character for each six code
 *  points, each bit a code point. Empty where the index doesn't hold one of them. */
export function indexCoverage(points: readonly number[], start: number): string {
	const held = points.filter((point) => point >= start && point < start + INDEX_SIZE).map((point) => point - start);
	if (held.length === 0) return "";
	const cells = Array.from({ length: Math.ceil(INDEX_SIZE / COVERAGE.bits) }, (_, cell) =>
		held.filter((offset) => Math.floor(offset / COVERAGE.bits) === cell).reduce((bits, offset) => bits | (1 << (offset % COVERAGE.bits)), 0),
	);
	return String.fromCharCode(...cells.map((cell) => cell + COVERAGE.base));
}

/** The code points a font covers as a CSS `unicode-range`, which the resolver reads to keep a run of characters in one font. */
const unicodeRange = (points: readonly number[]): string => points.map((point) => `U+${point.toString(16).toUpperCase()}`).join(",");

/** What a request under the fallback address is: a code point index, a fallback font's metadata, or its file. */
export type TLabelFontFallback = { kind: "json"; body: unknown } | { kind: "font"; font: TFallbackFont };

const INDEX = /^codepoint-index\/plane(\d+)\/([0-9a-f]+)-[0-9a-f]+\.json$/;
const META = /^font-meta\/(\w+)\.json$/;
const FILE = /^font-files\/(\w+)\/([\w-]+)\.(\w+)\.(\d+)\.woff$/;
const isFallbackFont = (id: string | undefined): id is TFallbackFont => Object.values(FALLBACK_FONT).some((font) => font === id);

/** Returns the response to `path`, the request's path below the fallback address, or undefined for a path the resolver
 *  doesn't request. */
export function labelFontFallback(path: string): TLabelFontFallback | undefined {
	const index = INDEX.exec(path);
	if (index !== null) {
		const start = index[2];
		if (start === undefined) throw new Error(`the index ${path} doesn't state its first code point`);
		const coverage = indexCoverage(MATH_CODE_POINTS, Number.parseInt(start, 16));
		// The resolver tests each language key as a pattern against the label's language; an empty pattern holds for every one.
		return { kind: "json", body: [SCHEMA_VERSION, coverage === "" ? {} : { "": { [FALLBACK_FONT.math]: coverage } }] };
	}
	const meta = META.exec(path)?.[1];
	if (isFallbackFont(meta)) {
		const typeforms = { [TYPEFORM.category]: { [TYPEFORM.style]: [TYPEFORM.weight] } };
		return { kind: "json", body: [SCHEMA_VERSION, { id: meta, typeforms, ranges: meta === FALLBACK_FONT.math ? unicodeRange(MATH_CODE_POINTS) : "" }] };
	}
	const file = FILE.exec(path);
	const font = file?.[1];
	if (file !== null && isFallbackFont(font) && file[2] === TYPEFORM.category && file[3] === TYPEFORM.style && Number(file[4]) === TYPEFORM.weight) return { kind: "font", font };
	return undefined;
}
