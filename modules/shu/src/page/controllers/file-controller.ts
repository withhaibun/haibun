/** Saves a file a view offers, for a view's save or download control. */
import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";

/** Saves `content` as a file named `name`, typed as bytes, so the browser saves it rather than opening it. */
export function saveFile(content: BlobPart, name: string): void {
	const anchor = document.createElement("a");
	anchor.href = URL.createObjectURL(new Blob([content], { type: MEDIA_TYPE.bytes }));
	anchor.download = name;
	anchor.click();
	URL.revokeObjectURL(anchor.href);
}
