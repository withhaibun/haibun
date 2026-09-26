/**
 * What the page embedding shu posts to it: the page the reader is on, which the ask pane sends as a turn's view. shu reads
 * a message only from the window that embeds it, at the origin the deployment names, and reads each by its schema.
 */
import { z } from "zod";
import { QuoteAnchorSchema } from "@haibun/core/lib/resources.js";
import { CallLinkSchema, PAGE_TERMS } from "@haibun/core/lib/hypermedia.js";
import { SharedSignal } from "./signals.js";
import { reportToRun } from "./client-log.js";

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
export const EmbeddedPageViewSchema = z
	.object({
		"@id": z.url(),
		"@type": z.literal(EMBEDDED_PAGE_TYPE),
		name: z.string(),
		selection: SelectionSchema.optional(),
		[PAGE_TERMS.next]: CallLinkSchema.optional(),
	})
	.strict();
export type TEmbeddedPageView = z.infer<typeof EmbeddedPageViewSchema>;

/** A message the embedding page posts: the page the reader is on, or null where the reader isn't on a page. */
export const EmbedderMessageSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("page-view"), view: EmbeddedPageViewSchema.nullable() }).strict()]);
export type TEmbedderMessage = z.infer<typeof EmbedderMessageSchema>;

/** The page the reader is on, as the embedding page last posted it. */
export const embeddedPageView = new SharedSignal<TEmbeddedPageView | null>("embeddedPageView", null);

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
		embeddedPageView.set(parsed.data.view);
	};
	frame.addEventListener("message", onMessage as EventListener);
	return () => frame.removeEventListener("message", onMessage as EventListener);
}

/** The posted page, as a block of a turn's view. */
export const embeddedViewLd = (): TEmbeddedPageView[] => {
	const view = embeddedPageView.get();
	return view ? [view] : [];
};
