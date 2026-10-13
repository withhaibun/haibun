/**
 * The responses to troika's lookup of fallback fonts, for a label character the label font lacks. troika requests from a
 * resolver the font that covers each such character: an index of a range of code points, the metadata of the font the
 * index names, and that font's file. shu returns every index with an empty coverage, which the resolver reads as the font
 * named `latin`, and serves its label font as that font, so a character the label font lacks draws as the font's missing
 * glyph instead of the page reading a font service (CA3D10).
 */

/** The font the resolver falls back to where an index leaves a character uncovered. */
const FALLBACK_FONT = "latin";

/** The resolver's data schema version, which it checks on every response. */
const SCHEMA_VERSION = 1;

/** The category, style and weight of the served fallback font. */
const TYPEFORM = { category: "sans-serif", style: "normal", weight: 400 } as const;

/** What a request under the fallback address is: a code point index, the fallback font's metadata, or its file. */
export type TLabelFontFallback = { kind: "json"; body: unknown } | { kind: "font" };

/** Returns the response to `path`, the request's path below the fallback address, or undefined for a path the resolver
 *  doesn't request. */
export function labelFontFallback(path: string): TLabelFontFallback | undefined {
	if (/^codepoint-index\/plane\d+\/[0-9a-f]+-[0-9a-f]+\.json$/.test(path)) return { kind: "json", body: [SCHEMA_VERSION, {}] };
	if (path === `font-meta/${FALLBACK_FONT}.json`) {
		const typeforms = { [TYPEFORM.category]: { [TYPEFORM.style]: [TYPEFORM.weight] } };
		return { kind: "json", body: [SCHEMA_VERSION, { id: FALLBACK_FONT, typeforms, ranges: "" }] };
	}
	if (path === `font-files/${FALLBACK_FONT}/${TYPEFORM.category}.${TYPEFORM.style}.${TYPEFORM.weight}.woff`) return { kind: "font" };
	return undefined;
}
