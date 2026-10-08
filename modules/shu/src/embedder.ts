/**
 * Defines the messages shu and its embedding page post to each other. The embedding page posts the page the reader has
 * open. The ask pane sends that page as a turn's view. The embedding page also posts a delegation to shu's page key.
 * shu requests that delegation by posting the key. shu reads a message only from the window that embeds it and only at the
 * origin the deployment names. shu parses each message by its schema.
 */
import { z } from "zod";
import { QuoteAnchorSchema } from "@haibun/core/lib/resources.js";
import { CallLinkSchema, PAGE_TERMS } from "@haibun/core/lib/hypermedia.js";
import type { TDelegation } from "@haibun/core/lib/actions.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { SharedSignal } from "./signals.js";
import { reportToRun } from "./client-log.js";
import { holdGiven } from "./page-key.js";
import { responseTimeoutMs } from "./rpc-registry.js";

/** The ActivityStreams type of the page the reader has open. */
export const EMBEDDED_PAGE_TYPE = "as:Page";
/** The source that each report from this module to actuality names. */
const EMBEDDER_SOURCE = "embedder";

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
type TFrameMessage = z.infer<typeof FrameMessageSchema>;

/** The page the reader has open, as the embedding page last posted it. */
export const embeddedPageView = new SharedSignal<TEmbeddedPageView | null>("embeddedPageView", null);

/** The delegation that the embedding page last gave to shu's page key. shu holds this delegation. */
export const givenDelegation = new SharedSignal<TDelegation | null>("givenDelegation", null);

/** The part of a frame's window that receives messages and references the embedding window (`parent`). */
type TFrameWindow = Pick<Window, "parent" | "addEventListener" | "removeEventListener">;

/**
 * Receives the messages the embedding page posts. Refuses a message from the embedding window at another origin and
 * reports it to actuality. Ignores a message from any other window, because that message isn't addressed to shu. Refuses and
 * reports a message that fails its schema and a delegation that `holdGiven` rejects. Returns the function that stops
 * receiving.
 */
export function receiveFromEmbedder(embedderOrigin: string, frame: TFrameWindow = window): () => void {
	const onMessage = (e: MessageEvent): void => {
		if (e.source !== frame.parent) return;
		if (e.origin !== embedderOrigin) return reportToRun("warn", EMBEDDER_SOURCE, "refused a message from an embedding page at another origin", { origin: e.origin });
		const parsed = EmbedderMessageSchema.safeParse(e.data);
		if (!parsed.success) return reportToRun("warn", EMBEDDER_SOURCE, "refused a message from the embedding page", { error: z.prettifyError(parsed.error) });
		const message = parsed.data;
		if (message.kind === EMBED_MESSAGE.pageView) return embeddedPageView.set(message.view);
		try {
			holdGiven(message.delegation, givenDelegation.get() ?? undefined);
			givenDelegation.set(message.delegation);
		} catch (err) {
			reportToRun("warn", EMBEDDER_SOURCE, "refused a delegation from the embedding page", { error: errorDetail(err) });
		}
	};
	frame.addEventListener("message", onMessage as EventListener);
	return () => frame.removeEventListener("message", onMessage as EventListener);
}

/**
 * Posts shu's page key to the embedding page to request a delegation to that key. Resolves once shu holds a new
 * delegation. Reports a warning to actuality and resolves where the embedding page doesn't give one within `waitMs`. The
 * caller then continues with the delegations shu already holds.
 */
export function askEmbedderToDelegate(embedderOrigin: string, controller: string, frame: Pick<Window, "parent"> = window, waitMs = responseTimeoutMs()): Promise<void> {
	return new Promise((resolve) => {
		const done = (): void => {
			clearTimeout(timer);
			stop();
			resolve();
		};
		const timer = setTimeout(() => {
			reportToRun("warn", EMBEDDER_SOURCE, "the embedding page didn't give a delegation to shu's page key", { controller, waitedMs: waitMs });
			done();
		}, waitMs);
		const stop = givenDelegation.subscribe(done);
		frame.parent.postMessage({ kind: EMBED_MESSAGE.pageKey, controller } satisfies TFrameMessage, embedderOrigin);
	});
}

/** Returns the posted page as a block of a turn's view, or an empty list where `embeddedPageView` holds null. */
export const embeddedViewLd = (): TEmbeddedPageView[] => {
	const view = embeddedPageView.get();
	return view ? [view] : [];
};
