/**
 * A file's bytes as a page sends them, and an image a step's result names, as schema.org's ImageObject names one: where
 * actuality keeps its bytes, and their media type. A record holds the reference, and a turn reads the bytes when it sends them.
 */
import { z } from "zod";

/** A media type's form: a type and a subtype. */
const MEDIA_TYPE = "[\\w.+-]+\\/[\\w.+-]+";

/** Whether a media type is an image's. */
export const isImageFormat = (encodingFormat: string): boolean => encodingFormat.startsWith("image/");

export const DOMAIN_IMAGE_REFERENCE = "image-reference";

export const ImageReferenceSchema = z.object({
	contentUrl: z.string().min(1).describe("Where actuality keeps the image's bytes."),
	encodingFormat: z.string().refine(isImageFormat).describe("The image's media type."),
});
export type TImageReference = z.infer<typeof ImageReferenceSchema>;

export const DOMAIN_FILE_DATA = "file-data";

/** A `data:` URL in base64: its media type, which a browser always states, any parameters, and its bytes. */
const FILE_DATA = new RegExp(`^data:(${MEDIA_TYPE})(?:;[\\w.+-]+=[^;,]*)*;base64,([A-Za-z0-9+/]*=*)$`);

export const FileDataSchema = z.string().regex(FILE_DATA).describe("A file's bytes as a data: URL in base64.");

/** What a record of a step states for a file's data: its media type and how many bytes it holds. */
export const recordedFileData = (value: unknown): string => {
	const { encodingFormat, base64 } = fileDataParts(String(value));
	return `a ${encodingFormat} file of ${Math.floor((base64.length * 3) / 4 - (base64.match(/=+$/)?.[0].length ?? 0))} bytes`;
};

/** A file's media type and its bytes in base64, from its data: URL. */
export function fileDataParts(data: string): { encodingFormat: string; base64: string } {
	const [, encodingFormat, base64] = FILE_DATA.exec(data) ?? [];
	if (encodingFormat === undefined || base64 === undefined) throw new Error("a file's data is a data: URL in base64 that states its media type");
	return { encodingFormat, base64 };
}
