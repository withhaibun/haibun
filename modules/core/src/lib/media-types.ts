/**
 * The media types actuality names (RFC 6838), in one place: what a record carries, the images a model takes, and the files
 * a browser opens as a page. A body is found by its media type, so a mistyped literal
 * writes a body a reader doesn't ask for and doesn't report the mismatch when it happens.
 */

export const MEDIA_TYPE = {
	markdown: "text/markdown",
	plain: "text/plain",
	html: "text/html",
	csv: "text/csv",
	json: "application/json",
	pdf: "application/pdf",
	zip: "application/zip",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	png: "image/png",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	oggAudio: "audio/ogg",
	webmAudio: "audio/webm",
	mpeg: "audio/mpeg",
	wav: "audio/wav",
	webm: "video/webm",
	mp4: "video/mp4",
	/** Bytes whose type isn't stated. */
	bytes: "application/octet-stream",
} as const;

/** Whether a media type is an image's. */
export const isImageFormat = (encodingFormat: string): boolean => encodingFormat.startsWith("image/");

/** The images a browser draws as pixels: an SVG image is a document that can hold a script, and isn't one of them. */
export const RASTER_IMAGE_TYPES: readonly string[] = [MEDIA_TYPE.png, MEDIA_TYPE.jpeg, MEDIA_TYPE.gif, MEDIA_TYPE.webp];

/**
 * The media types a browser shows as what they are without running a script in them: a PDF, a raster image, audio, video
 * and plain text. A page opens a file of one of these types in a tab of its own. A file of any other type, as HTML, SVG or
 * XML, which a browser runs as a document of the page's own origin, is saved instead, since its sender chose its type.
 */
const VIEWED_IN_BROWSER: readonly string[] = [
	MEDIA_TYPE.pdf,
	MEDIA_TYPE.plain,
	...RASTER_IMAGE_TYPES,
	MEDIA_TYPE.oggAudio,
	MEDIA_TYPE.webmAudio,
	MEDIA_TYPE.mpeg,
	MEDIA_TYPE.wav,
	MEDIA_TYPE.webm,
	MEDIA_TYPE.mp4,
];

/** Whether a page opens a file of a media type in a tab of its own, rather than saving it. */
export const viewedInBrowser = (mediaType: string): boolean => VIEWED_IN_BROWSER.includes(mediaType);
