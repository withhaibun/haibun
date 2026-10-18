/**
 * Media fragments: the fragment of a document's or media's address that locates a part of it, as a Web Annotation
 * FragmentSelector holds it. A PDF's page (RFC 8118), a span of audio or video and a region of an image (Media Fragments).
 */
import { z } from "zod";
import { locateQuoteOffsets } from "./quote-anchor.js";
import { MEDIA_TYPE, isImageFormat } from "./media-types.js";

/** The specifications a FragmentSelector's value conforms to, as the Web Annotation model names them: RFC 8118 for a PDF's
 *  page, Media Fragments for a span of audio or video and a region of an image. */
export const FRAGMENT_SPEC = { pdf: "http://tools.ietf.org/rfc/rfc8118", media: "http://www.w3.org/TR/media-frags/" } as const;

/** A part of a document or media located by a fragment of its address (a Web Annotation FragmentSelector's fields): its
 *  value, as `page=2`, `t=30,60` or `xywh=0,0,100,100`, and the specification that defines it. */
export const FragmentSchema = z.object({
	conformsTo: z.enum([FRAGMENT_SPEC.pdf, FRAGMENT_SPEC.media]).describe("The specification the value conforms to."),
	value: z.string().describe("The fragment, as `page=2`, `t=30,60` or `xywh=0,0,100,100`."),
});
export type TFragment = z.infer<typeof FragmentSchema>;

/** Whether a part is a fragment of media, where the other kind of part quotes a passage. */
export const isFragment = (part: object): part is TFragment => "conformsTo" in part;

/**
 * The fragments a part of a record's media is named by: each key, the specification its value conforms to, the form of
 * its value, and the media types it is read for, as `page=2` of a PDF, `t=30,60` of audio or video, and
 * `xywh=0,0,100,100` of an image.
 */
export const MEDIA_FRAGMENTS = [
	{ key: "page", conformsTo: FRAGMENT_SPEC.pdf, form: /^[1-9]\d*$/, of: "a PDF", reads: (mediaType: string) => mediaType === MEDIA_TYPE.pdf },
	{
		key: "t",
		conformsTo: FRAGMENT_SPEC.media,
		form: /^(npt:)?(\d+(\.\d+)?(,\d+(\.\d+)?)?|,\d+(\.\d+)?)$/,
		of: "audio or video",
		reads: (mediaType: string) => /^(audio|video)\//.test(mediaType),
	},
	{ key: "xywh", conformsTo: FRAGMENT_SPEC.media, form: /^(pixel:|percent:)?\d+,\d+,\d+,\d+$/, of: "an image", reads: isImageFormat },
] as const;

/** The kind of fragment a fragment is, by the key it is written with. */
const specOf = (fragment: TFragment) => MEDIA_FRAGMENTS.find(({ key }) => fragment.value.startsWith(`${key}=`));

/** Whether a fragment is read for a media type, as a PDF's page is for a PDF. */
export const fragmentReads = (fragment: TFragment, mediaType: string): boolean => specOf(fragment)?.reads(mediaType) ?? false;

/** A fragment read for a media type; a fragment of another kind of media fails, so a reader isn't shown the whole file as
 *  though it were the part. */
export function assertFragmentReads(fragment: TFragment, mediaType: string): void {
	if (!fragmentReads(fragment, mediaType)) throw new Error(`"${fragment.value}" is a fragment of ${specOf(fragment)?.of ?? "unknown media"}, and the file is ${mediaType}`);
}

/** The mark extraction writes into a document's text where each page begins, in the form the extractor takes, its page's
 *  number in place of `{page_num}`. An HTML comment, so the text reads and renders as it would without it. */
export const PAGE_MARKER_FORMAT = "\n\n<!-- page {page_num} -->\n\n";
const PAGE_MARKER = /<!-- page (\d+) -->/g;

/** The fragment that names a page of a PDF. */
export const pdfPage = (page: number): TFragment => ({ conformsTo: FRAGMENT_SPEC.pdf, value: `page=${page}` });

/** The page of a document a passage is on, as its text marks each page's beginning: the page the last mark before the
 *  passage begins. Undefined where the text doesn't hold the passage, or doesn't mark its pages. */
export function pageOfPassage(text: string, quote: { exact: string; prefix?: string; suffix?: string }): number | undefined {
	const at = locateQuoteOffsets(text, quote.exact, quote.prefix, quote.suffix);
	if (!at) return undefined;
	const marks = [...text.slice(0, at.start).matchAll(PAGE_MARKER)];
	const last = marks[marks.length - 1];
	return last ? Number(last[1]) : undefined;
}
