import { describe, it, expect } from "vitest";
import { MEDIA_TYPE, RASTER_IMAGE_TYPES, viewedInBrowser } from "./media-types.js";

describe("the files a page opens in a tab of its own", () => {
	it("are those a browser shows as they are: a PDF, a raster image, audio, video and plain text", () => {
		for (const viewed of [MEDIA_TYPE.pdf, MEDIA_TYPE.plain, ...RASTER_IMAGE_TYPES, MEDIA_TYPE.mpeg, MEDIA_TYPE.mp4]) expect(viewedInBrowser(viewed), viewed).toBe(true);
	});

	it("aren't those a browser runs as a document with the page's origin, which are saved instead", () => {
		for (const saved of [MEDIA_TYPE.html, MEDIA_TYPE.svg, "application/xhtml+xml", MEDIA_TYPE.bytes]) expect(viewedInBrowser(saved), saved).toBe(false);
	});
});
