/**
 * An image a record or a step's result names, as schema.org's ImageObject names one: where actuality keeps its bytes, and
 * their media type. A record holds the reference, and a turn reads the bytes when it sends them.
 */
import { z } from "zod";

/** A media type's form: a type and a subtype. */
const MEDIA_TYPE_FORM = /^[\w.+-]+\/[\w.+-]+$/;
/** The media type of bytes whose type isn't known. */
export const UNKNOWN_MEDIA_TYPE = "application/octet-stream";

export const DOMAIN_IMAGE_REFERENCE = "image-reference";

export const ImageReferenceSchema = z.object({
	contentUrl: z.string().min(1).describe("Where actuality keeps the image's bytes."),
	encodingFormat: z
		.string()
		.regex(/^image\//)
		.describe("The image's media type."),
});
export type TImageReference = z.infer<typeof ImageReferenceSchema>;

/** The image formats a model that reads images is sent as an image. A file in another format, a vector image among them,
 *  is read for the text it holds. */
export const IMAGE_FORMATS_SENT = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/** Whether a file is sent to a model as an image. */
export const sentAsImage = (encodingFormat: string): boolean => (IMAGE_FORMATS_SENT as readonly string[]).includes(encodingFormat);

export const DOMAIN_MEDIA_OBJECT = "media-object";

/** A file a person adds, as schema.org's MediaObject names one: where actuality keeps its bytes, their media type, and
 *  the name the file had. */
export const MediaObjectSchema = z.object({
	contentUrl: z.string().min(1).describe("Where actuality keeps the file's bytes."),
	encodingFormat: z.string().regex(MEDIA_TYPE_FORM).describe("The file's media type."),
	name: z.string().min(1).describe("The name the file had."),
});
export type TMediaObject = z.infer<typeof MediaObjectSchema>;

export const DOMAIN_FILE_DATA = "file-data";

/** A file's bytes as a `data:` URL in base64, in any media type. */
export const FileDataSchema = z
	.string()
	.regex(/^data:([\w.+-]+\/[\w.+-]+)?(;[\w.+-]+=[^;,]*)*;base64,[A-Za-z0-9+/]*=*$/)
	.describe("A file's bytes as a data: URL in base64.");
