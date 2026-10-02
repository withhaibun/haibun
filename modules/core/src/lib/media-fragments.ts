/**
 * Media fragments: the fragment of a document's or media's address that locates a part of it, as a Web Annotation
 * FragmentSelector holds it. A PDF's page (RFC 8118), a span of audio or video and a region of an image (Media Fragments).
 */
import { z } from "zod";

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
	{ key: "page", conformsTo: FRAGMENT_SPEC.pdf, form: /^[1-9]\d*$/, of: "a PDF", reads: (mediaType: string) => mediaType === "application/pdf" },
	{
		key: "t",
		conformsTo: FRAGMENT_SPEC.media,
		form: /^(npt:)?(\d+(\.\d+)?(,\d+(\.\d+)?)?|,\d+(\.\d+)?)$/,
		of: "audio or video",
		reads: (mediaType: string) => /^(audio|video)\//.test(mediaType),
	},
	{ key: "xywh", conformsTo: FRAGMENT_SPEC.media, form: /^(pixel:|percent:)?\d+,\d+,\d+,\d+$/, of: "an image", reads: (mediaType: string) => mediaType.startsWith("image/") },
] as const;

/** Whether a fragment is read for a media type, as a PDF's page is for a PDF; a fragment of another kind of media fails, so
 *  a reader isn't shown the whole file as though it were the part. */
export function assertFragmentReads(fragment: TFragment, mediaType: string): void {
	const spec = MEDIA_FRAGMENTS.find(({ key }) => fragment.value.startsWith(`${key}=`));
	if (!spec?.reads(mediaType)) throw new Error(`"${fragment.value}" is a fragment of ${spec?.of ?? "unknown media"}, and the file is ${mediaType}`);
}
