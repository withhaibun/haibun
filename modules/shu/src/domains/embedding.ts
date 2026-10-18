/**
 * The messages shu and the page that embeds it post to each other. The embedding page posts the page the reader has open,
 * which the ask sends as a turn's view, and a delegation to shu's page key, which shu requests by posting the key.
 */
import { z } from "zod";
import { QuoteAnchorSchema } from "@haibun/core/lib/resources.js";
import { CallLinkSchema, PAGE_TERMS } from "@haibun/core/lib/domains/hypermedia.js";

/** The ActivityStreams type of the page the reader has open. */
export const EMBEDDED_PAGE_TYPE = "as:Page";

/** A passage the reader selected on the page. The schema holds the passage as a Web Annotation SpecificResource. The
 *  resource's TextQuoteSelector quotes the passage's exact text with an optional prefix and suffix. */
const SelectionSchema = z
	.object({ "@type": z.literal("oa:SpecificResource"), source: z.url(), selector: QuoteAnchorSchema.extend({ "@type": z.literal("oa:TextQuoteSelector") }).strict() })
	.strict();

/** The page the reader has open, as the embedding page posts it. It holds the page's address, its title and any passage
 *  the reader selected. The embedding page adds the call that reads the page once the page's tab is attached. */
const EmbeddedPageViewSchema = z
	.object({ "@id": z.url(), "@type": z.literal(EMBEDDED_PAGE_TYPE), name: z.string(), selection: SelectionSchema.optional(), [PAGE_TERMS.next]: CallLinkSchema.optional() })
	.strict();
export type TEmbeddedPageView = z.infer<typeof EmbeddedPageViewSchema>;

/** A zcap-LD delegation as the embedding page signs it. It names the controller key, the parent capability, the invocation target and the expiry. */
const GivenDelegationSchema = z.looseObject({
	id: z.string(),
	controller: z.string(),
	parentCapability: z.string(),
	invocationTarget: z.string(),
	expires: z.iso.datetime(),
	proof: z.looseObject({}),
});

/** The kinds of message that shu and its embedding page post to each other. */
export const EMBED_MESSAGE = { pageView: "page-view", delegation: "delegation", pageKey: "page-key" } as const;

/** A message the embedding page posts. A page-view message holds the page the reader has open, or null where the reader
 *  doesn't have a page open. A delegation message holds a delegation to shu's page key. */
export const EmbedderMessageSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal(EMBED_MESSAGE.pageView), view: EmbeddedPageViewSchema.nullable() }).strict(),
	z.object({ kind: z.literal(EMBED_MESSAGE.delegation), delegation: GivenDelegationSchema }).strict(),
]);
export type TEmbedderMessage = z.infer<typeof EmbedderMessageSchema>;

/** A message shu posts to its embedding page. It holds shu's page key. The embedding page delegates to that key. */
export const FrameMessageSchema = z.object({ kind: z.literal(EMBED_MESSAGE.pageKey), controller: z.string() }).strict();
export type TFrameMessage = z.infer<typeof FrameMessageSchema>;
