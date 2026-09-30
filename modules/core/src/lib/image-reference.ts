/**
 * An image a record or a step's result names, as schema.org's ImageObject names one: where actuality keeps its bytes, and
 * their media type. A record holds the reference, and a turn reads the bytes when it sends them.
 */
import { z } from "zod";

export const DOMAIN_IMAGE_REFERENCE = "image-reference";

export const ImageReferenceSchema = z.object({
	contentUrl: z.string().min(1).describe("Where actuality keeps the image's bytes."),
	encodingFormat: z
		.string()
		.regex(/^image\//)
		.describe("The image's media type."),
});
export type TImageReference = z.infer<typeof ImageReferenceSchema>;

/** The raster formats an image a person adds is kept in. A vector image can carry script, so one isn't kept. */
export const KEPT_IMAGE_FORMATS = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export const DOMAIN_IMAGE_DATA = "image-data";

/** An image's bytes as a `data:` URL in base64, in one of the formats kept. */
export const ImageDataSchema = z
	.string()
	.regex(new RegExp(`^data:(${KEPT_IMAGE_FORMATS.map((format) => format.replace("/", "\\/")).join("|")});base64,[A-Za-z0-9+/]+=*$`))
	.describe("An image's bytes as a data: URL in base64, as PNG, JPEG, GIF or WebP.");
