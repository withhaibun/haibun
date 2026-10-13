/** What the browser relay holds and reads, as the steps that reach a person's attached browser return it: its tabs, a tab's text, and the attachment. */
import { z } from "zod";

/** A tab open in the attached browser, as the extension lists it. */
export const BrowserTabSchema = z.object({ id: z.number(), title: z.string().optional(), url: z.string().optional() });
export type TBrowserTab = z.infer<typeof BrowserTabSchema>;

export const DOMAIN_BROWSER_TAB = "browser-tab";
export const DOMAIN_BROWSER_TABS = "browser-tabs";
/** Every tab open in the attached browser. */
export const BrowserTabsSchema = z.object({ tabs: z.array(BrowserTabSchema) });

export const DOMAIN_BROWSER_TAB_TEXT = "browser-tab-text";
/** A tab's title, its address and the text its page shows. */
export const BrowserTabTextSchema = BrowserTabSchema.extend({ text: z.string() });
export type TBrowserTabText = z.infer<typeof BrowserTabTextSchema>;

/** The domain of what the relay holds. */
export const DOMAIN_RELAY_ATTACHMENT = "relay-attachment";
/** What the relay holds: whether a person's browser is attached, the key that attached it, and its tabs. */
export const RelayAttachmentSchema = z.object({
	attached: z.boolean().describe("Whether a browser is attached."),
	holder: z.string().optional().describe("The key that attached it, where it proved one."),
	tabs: z
		.array(z.object({ id: z.number(), title: z.string().optional(), url: z.string().optional(), attached: z.boolean().describe("Whether actuality drives the tab.") }))
		.describe("The tabs the extension reported."),
});
export type TRelayAttachment = z.infer<typeof RelayAttachmentSchema>;
