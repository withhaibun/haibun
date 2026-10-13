/** The attached browser's tabs as the steps return them, each read into its domain. */
import { BrowserTabSchema, BrowserTabTextSchema, type TBrowserTab, type TBrowserTabText } from "../domains/relay.js";
import type { TBrowserRelay } from "../ports.js";

/** Every tab open in the attached browser that states its id. */
export const listTabs = async (relay: TBrowserRelay): Promise<{ tabs: TBrowserTab[] }> => ({
	tabs: (await relay.listTabs()).filter((tab) => tab.id !== undefined).map((tab) => BrowserTabSchema.parse(tab)),
});

export const readTab = async (relay: TBrowserRelay, tabId: number): Promise<TBrowserTabText> => BrowserTabTextSchema.parse(await relay.readTab(tabId));

export const openTab = async (relay: TBrowserRelay, url: string): Promise<TBrowserTab> => BrowserTabSchema.parse(await relay.openTab(url));
