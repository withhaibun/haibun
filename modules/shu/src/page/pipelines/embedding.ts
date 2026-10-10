/**
 * What shu reads from the page that embeds it, and what it requests. shu reads a message from the embedding window alone,
 * at the origin the deployment names, and parses each message by its schema. It holds the page the reader has open, and the
 * delegation the embedding page gives shu's page key. Each refusal is reported to actuality.
 */
import { z } from "zod";
import type { TDelegation } from "@haibun/core/lib/actions.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { EMBED_MESSAGE, EmbedderMessageSchema, type TEmbeddedPageView } from "../../domains/embedding.js";
import { reportToRun } from "../../client-log.js";
import type { TAuthority, TClock, TEmbedderChannel, TSharedCell } from "../ports.js";

/** The source each report of this pipeline names. */
const EMBEDDER_SOURCE = "embedder";

/** What the pipeline reads and writes: the channel to the embedding window, the cells of the page view and the delegation
 *  the embedding page last posted, the reader's authority, which holds the delegation, and the page's clock. */
export type TEmbedding = { channel: TEmbedderChannel; pageView: TSharedCell<TEmbeddedPageView | null>; given: TSharedCell<TDelegation | null>; authority: TAuthority; clock: TClock };

/** Receives the messages the embedding page posts. Refuses and reports a message from another origin, a message its schema
 *  refuses and a delegation the reader's authority refuses. Returns the call that stops receiving. */
export function receiveFromEmbedder({ channel, pageView, given, authority }: TEmbedding): () => void {
	return channel.receive(
		(data) => {
			const parsed = EmbedderMessageSchema.safeParse(data);
			if (!parsed.success) return reportToRun("warn", EMBEDDER_SOURCE, "refused a message from the embedding page", { error: z.prettifyError(parsed.error) });
			const message = parsed.data;
			if (message.kind === EMBED_MESSAGE.pageView) return pageView.set(message.view);
			const held = given.get();
			try {
				authority.hold(message.delegation, held === null ? undefined : held);
				given.set(message.delegation);
			} catch (err) {
				reportToRun("warn", EMBEDDER_SOURCE, "refused a delegation from the embedding page", { error: errorDetail(err) });
			}
		},
		(origin) => reportToRun("warn", EMBEDDER_SOURCE, "refused a message from an embedding page at another origin", { origin }),
	);
}

/** Posts shu's page key to the embedding page to request a delegation to it. Resolves once shu holds a new delegation, or
 *  after `waitMs`, where it reports to actuality that the embedding page didn't give one, and the page continues with the
 *  delegations it holds. */
export function askEmbedderToDelegate({ channel, given, clock }: TEmbedding, controller: string, waitMs: number): Promise<void> {
	return new Promise((resolve) => {
		const done = (): void => {
			cancel();
			stop();
			resolve();
		};
		const cancel = clock.after(waitMs, () => {
			reportToRun("warn", EMBEDDER_SOURCE, "the embedding page didn't give a delegation to shu's page key", { controller, waitedMs: waitMs });
			done();
		});
		const stop = given.subscribe(done);
		channel.post({ kind: EMBED_MESSAGE.pageKey, controller });
	});
}
