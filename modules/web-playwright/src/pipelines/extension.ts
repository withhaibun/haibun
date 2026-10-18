/** The extension the browser runs: its worker, once it starts, and the side panel its toolbar button opens, as the worker reads it. */
import type { Worker } from "playwright";
import { actionNotOK, actionOKWithProducts } from "@haibun/core/lib/domains/util.js";
import type { TActionResult } from "@haibun/core/lib/domains/protocol.js";
import type { BrowserSession } from "./browser-session.js";
import type { TLoadedExtension } from "./browser-options.js";

/** The side panel an extension's toolbar button opens, read in the extension's worker, the one context that reads its side
 *  panel API. The worker evaluates it, so it names only what the worker holds. */
async function readSidePanel(): Promise<{ path: string; opensOnAction: boolean }> {
	type TSidePanel = { getOptions(of: object): Promise<{ path?: string }>; getPanelBehavior(): Promise<{ openPanelOnActionClick?: boolean }> };
	const { sidePanel } = (globalThis as unknown as { chrome: { sidePanel: TSidePanel } }).chrome;
	const [options, behavior] = await Promise.all([sidePanel.getOptions({}), sidePanel.getPanelBehavior()]);
	if (options.path === undefined) throw new Error("the extension declares a side panel without a path");
	return { path: options.path, opensOnAction: behavior.openPanelOnActionClick === true };
}

/** The extension the browser runs. A worker that doesn't start within the step's timeout fails the step, so an extension
 *  whose worker fails to load fails it. */
export async function runningExtension(session: BrowserSession, extension: TLoadedExtension | undefined): Promise<TActionResult> {
	if (extension === undefined) return actionNotOK("actuality hasn't loaded a browser extension: `load the browser extension at` loads one");
	const { id, origin } = extension;
	if (!extension.worker) return actionOKWithProducts({ id, origin });
	const context = (await session.page()).context();
	const ours = (worker: Worker) => worker.url().startsWith(origin);
	const worker = context.serviceWorkers().find(ours) ?? (await context.waitForEvent("serviceworker", { predicate: ours }));
	const sidePanel = extension.sidePanel ? await worker.evaluate(readSidePanel) : undefined;
	return actionOKWithProducts({ id, origin, worker: worker.url(), ...(sidePanel === undefined ? {} : { sidePanel }) });
}
