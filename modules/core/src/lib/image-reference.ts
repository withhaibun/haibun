/**
 * An image a record or a step's result names, as schema.org's ImageObject names one: where the run keeps its bytes, and
 * their media type. A record holds the reference, and a turn reads the bytes when it sends them.
 */
import { z } from "zod";

export const DOMAIN_IMAGE_REFERENCE = "image-reference";

export const ImageReferenceSchema = z.object({
	contentUrl: z.string().min(1).describe("Where the run keeps the image's bytes."),
	encodingFormat: z.string().regex(/^image\//).describe("The image's media type."),
});
export type TImageReference = z.infer<typeof ImageReferenceSchema>;
