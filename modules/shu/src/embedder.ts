/**
 * What shu and the page embedding it post each other. The embedding page posts the page the reader is on, which the ask
 * pane sends as a turn's view, and a delegation to the key shu signs as, which shu asks for by posting that key. shu reads
 * a message only from the window that embeds it, at the origin the deployment names, and reads each by its schema.
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

/** The ActivityStreams type of the page the reader is on. */
export const EMBEDDED_PAGE_TYPE = "as:Page";
/** The source a refused message is reported under. */
const EMBEDDER_SOURCE = "embedder";

/** A passage the reader selected on the page: a Web Annotation SpecificResource, located by quoting it. */
const SelectionSchema = z
	.object({
		"@type": z.literal("oa:SpecificResource"),
		source: z.url(),
		selector: QuoteAnchorSchema.extend({ "@type": z.literal("oa:TextQuoteSelector") }).strict(),
	})
	.strict();

/** The page the reader is on, as the embedding page posts it: its address, its title, the passage the reader selected,
 *  and the call that reads the page, which the embedding page states once the page's tab is attached. */
const EmbeddedPageViewSchema = z
	.object({
		"@id": z.url(),
		"@type": z.literal(EMBEDDED_PAGE_TYPE),
		name: z.string(),
		selection: SelectionSchema.optional(),
		[PAGE_TERMS.next]: CallLinkSchema.optional(),
	})
	.strict();
export type TEmbeddedPageView = z.infer<typeof EmbeddedPageViewSchema>;

/** A zcap-LD delegation as the embedding page signs one: to a key, from a capability, over a target, until it expires. */
const GivenDelegationSchema = z.looseObject({
	id: z.string(),
	controller: z.string(),
	parentCapability: z.string(),
	invocationTarget: z.string(),
	expires: z.iso.datetime(),
	proof: z.looseObject({}),
});

/** The kinds of message shu and the page embedding it post each other. */
export const EMBED_MESSAGE = { pageView: "page-view", delegation: "delegation", pageKey: "page-key" } as const;

/** A message the embedding page posts: the page the reader is on, or null where the reader isn't on a page; or a
 *  delegation to the key shu signs as. */
export const EmbedderMessageSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal(EMBED_MESSAGE.pageView), view: EmbeddedPageViewSchema.nullable() }).strict(),
	z.object({ kind: z.literal(EMBED_MESSAGE.delegation), delegation: GivenDelegationSchema }).strict(),
]);
export type TEmbedderMessage = z.infer<typeof EmbedderMessageSchema>;

/** A message shu posts to the page embedding it: the key shu signs as, which that page delegates to. */
export const FrameMessageSchema = z.object({ kind: z.literal(EMBED_MESSAGE.pageKey), controller: z.string() }).strict();
type TFrameMessage = z.infer<typeof FrameMessageSchema>;

/** The page the reader is on, as the embedding page last posted it. */
export const embeddedPageView = new SharedSignal<TEmbeddedPageView | null>("embeddedPageView", null);

/** The delegation the embedding page last gave the key shu signs as, which shu holds. */
export const givenDelegation = new SharedSignal<TDelegation | null>("givenDelegation", null);

/** The window a frame receives messages in, and the window that embeds it. */
type TFrameWindow = Pick<Window, "parent" | "addEventListener" | "removeEventListener">;

/**
 * Receives what the embedding page posts. A message from the embedding window at another origin is refused and reported
 * to the run, and a message from any other window isn't addressed to shu. Returns the function that stops receiving.
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
 * Ask the embedding page to delegate to the key shu signs as, by posting the key, and wait until shu holds the delegation.
 * A page that isn't given one within `waitMs` goes on with what it holds, and the run is told.
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

/** The posted page, as a block of a turn's view. */
export const embeddedViewLd = (): TEmbeddedPageView[] => {
	const view = embeddedPageView.get();
	return view ? [view] : [];
};
