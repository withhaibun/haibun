/** Saves a file a view offers, for a view's save or download control, and opens one a browser shows in a tab of its own. */
import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";

/** Saves `content` as a file named `name`, typed as bytes, so the browser saves it rather than opening it. */
export function saveFile(content: BlobPart, name: string): void {
	const anchor = document.createElement("a");
	anchor.href = URL.createObjectURL(new Blob([content], { type: MEDIA_TYPE.bytes }));
	anchor.download = name;
	anchor.click();
	URL.revokeObjectURL(anchor.href);
}

/** Opens `content` in a tab of its own at `fragment`, without a reference to this page (noopener), so the browser makes the
 *  tab apart from this page's process. Where a DevTools client drives the browser, as a test does, Chromium aborts the
 *  IndexedDB transactions a page has in flight while it makes a tab in the page's process. A browser opens a tab only
 *  shortly after a click, which `navigator.userActivation` states, so a later call is refused. */
export function showFile(content: Blob, name: string, fragment: string | undefined): void {
	if (!navigator.userActivation.isActive) throw new Error(`the browser opens a tab for ${name} only shortly after a click, and reading the file took longer; follow it again`);
	window.open(`${URL.createObjectURL(content)}${fragment === undefined ? "" : `#${fragment}`}`, "_blank", "noopener");
}
