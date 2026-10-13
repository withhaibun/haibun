/** A download the page starts: expected before the action that causes it, and saved to a file once it arrives. */
import { actionNotOK, errorDetail } from "@haibun/core/lib/util/index.js";
import { OK, type TActionResult } from "@haibun/core/schema/protocol.js";
import type { BrowserSession } from "./browser-session.js";

/** Expects the page's next download. Waiting for an event isn't an action on the page, so it doesn't hold the page from the action that causes it. */
export function expectDownload(session: BrowserSession): TActionResult {
	const expected = session.page().then((page) => page.waitForEvent("download"));
	// The step that receives the download reads its failure; until then it is held.
	void expected.catch(() => undefined);
	session.expectedDownload = expected;
	return OK;
}

/** Saves the expected download to `file`, which the feature's end removes. */
export async function receiveDownload(session: BrowserSession, file: string): Promise<TActionResult> {
	const expected = session.expectedDownload;
	if (expected === undefined) return actionNotOK("receiving a download follows `expect a download`, and a download isn't expected");
	try {
		await (await expected).saveAs(file);
		session.downloaded.push(file);
		return OK;
	} catch (e) {
		return actionNotOK(`the download wasn't saved to ${file}: ${errorDetail(e)}`);
	}
}
