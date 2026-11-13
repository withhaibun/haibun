/**
 * File-extension and media-type lookups, kept separate from `media-types.ts` so browser bundles that only name
 * `MEDIA_TYPE` do not carry the extension table.
 */
import { MEDIA_TYPE } from "./media-types.js";

/** Extension to media type mapping; when a media type has multiple extensions, its canonical extension comes first. */
export const EXTENSION_MEDIA_TYPES: Readonly<Record<string, string>> = {
	".png": MEDIA_TYPE.png,
	".jpg": MEDIA_TYPE.jpeg,
	".jpeg": MEDIA_TYPE.jpeg,
	".webp": MEDIA_TYPE.webp,
	".gif": MEDIA_TYPE.gif,
	".md": MEDIA_TYPE.markdown,
	".markdown": MEDIA_TYPE.markdown,
	".bin": MEDIA_TYPE.bytes,
};

/** Returns the media type for a path by its extension, or undefined when the extension is not registered. */
export function mediaTypeForPath(path: string): string | undefined {
	const dot = path.lastIndexOf(".");
	if (dot === -1) return undefined;
	return EXTENSION_MEDIA_TYPES[path.slice(dot).toLowerCase()];
}

/** Returns the file extension (without leading dot) for a media type. */
export function extensionForMediaType(mediaType: string): string {
	const semi = mediaType.indexOf(";");
	const baseType = (semi === -1 ? mediaType : mediaType.slice(0, semi)).trim().toLowerCase();
	for (const [ext, type] of Object.entries(EXTENSION_MEDIA_TYPES)) {
		if (type === baseType) return ext.slice(1);
	}
	const rawSubtype = baseType.split("/")[1];
	const subtype = rawSubtype === undefined ? "" : rawSubtype;
	const rawBase = subtype.split("+")[0]?.replace(/[^\w.-]/g, "");
	const base = rawBase === undefined ? "" : rawBase;
	return base === "" ? "bin" : base;
}
