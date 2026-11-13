import { describe, expect, it } from "vitest";
import { MEDIA_TYPE, isImageFormat } from "./media-types.js";
import { extensionForMediaType, mediaTypeForPath } from "./media-type-extensions.js";

describe("mediaTypeForPath", () => {
	it("maps registered file extensions to declared media types", () => {
		expect(mediaTypeForPath("photo.png")).toBe(MEDIA_TYPE.png);
		expect(mediaTypeForPath("image.jpg")).toBe(MEDIA_TYPE.jpeg);
		expect(mediaTypeForPath("image.JPEG")).toBe(MEDIA_TYPE.jpeg);
		expect(mediaTypeForPath("graphic.webp")).toBe(MEDIA_TYPE.webp);
		expect(mediaTypeForPath("anim.gif")).toBe(MEDIA_TYPE.gif);
		expect(mediaTypeForPath("readme.md")).toBe(MEDIA_TYPE.markdown);
		expect(mediaTypeForPath("notes.markdown")).toBe(MEDIA_TYPE.markdown);
	});

	it("identifies image media types via isImageFormat", () => {
		const png = mediaTypeForPath("diagram.png");
		expect(png !== undefined && isImageFormat(png)).toBe(true);
		const md = mediaTypeForPath("notes.md");
		expect(md !== undefined && isImageFormat(md)).toBe(false);
		expect(mediaTypeForPath("notes.txt")).toBeUndefined();
		expect(mediaTypeForPath("noextension")).toBeUndefined();
	});
});

describe("extensionForMediaType", () => {
	it("returns canonical extensions from the shared table and falls back to subtype", () => {
		expect(extensionForMediaType(MEDIA_TYPE.jpeg)).toBe("jpg");
		expect(extensionForMediaType(MEDIA_TYPE.png)).toBe("png");
		expect(extensionForMediaType(MEDIA_TYPE.webp)).toBe("webp");
		expect(extensionForMediaType(MEDIA_TYPE.markdown)).toBe("md");
		expect(extensionForMediaType(MEDIA_TYPE.bytes)).toBe("bin");
		expect(extensionForMediaType(MEDIA_TYPE.pdf)).toBe("pdf");
		expect(extensionForMediaType(MEDIA_TYPE.svg)).toBe("svg");
		expect(extensionForMediaType("")).toBe("bin");
	});
});
