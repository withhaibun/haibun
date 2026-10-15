/**
 * The page's side of the blip channel. A view records an occurrence where it happens, at any rate, every frame included:
 * the record holds the occurrence in the page's ring and returns, without a request. The page sends what the ring holds in
 * one batch, after a pause that gathers a burst of frames, through `MonitorStepper`. A page sends a batch only where the
 * ring holds an occurrence. Actuality takes each occurrence into the channel a recording on its side reaches, and doesn't
 * retain it.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { reads } from "../domains/links.js";
import { RECORD_BLIPS_ACTION, RECORD_BLIPS_METHOD } from "../domains/page-calls.js";
import { reportToRun } from "../../client-log.js";
import type { TBlipRing, TClock, TConduit } from "../ports.js";

/** How long the page waits before it sends, so a burst of frames leaves as one batch. */
const FLUSH_DELAY_MS = 250;

/** The send the page holds: the call that cancels it, or undefined where the page doesn't hold one. */
export type TBlipSending = { cancel: (() => void) | undefined };

/** What recording and sending read: the page's ring, its pending send, its clock, whether the page holds an action, and its
 *  conduit, which is undefined for a page that carries a record of actuality or is mounted without one, and holds what it
 *  records. */
export type TBlipChannel = { ring: TBlipRing; sending: TBlipSending; clock: TClock; may: (action: string) => boolean; conduit: TConduit | undefined };

/** Records one occurrence of `name`, and sends the ring after the pause where the page doesn't hold a send. */
export function recordClientBlip(channel: TBlipChannel, name: string, value: number | undefined, attributes: Record<string, unknown> | undefined): void {
	channel.ring.record({ name, value, attributes, at: channel.clock.now() });
	const { conduit, sending, clock } = channel;
	if (sending.cancel !== undefined || conduit === undefined) return;
	sending.cancel = clock.after(FLUSH_DELAY_MS, () => {
		sending.cancel = undefined;
		void flushClientBlips(channel);
	});
}

/** Sends what the ring holds as one batch. A page that doesn't hold the private read keeps what it recorded, as it keeps a
 *  diagnostic until its key holds that read. A batch actuality doesn't receive is reported, and its occurrences are lost,
 *  since actuality doesn't retain one. */
export async function flushClientBlips({ ring, may, conduit }: TBlipChannel): Promise<void> {
	if (conduit === undefined) throw new Error("a page that holds its occurrences without a conduit doesn't send them");
	if (!may(RECORD_BLIPS_ACTION)) return;
	const batch = ring.take();
	if (batch.length === 0) return;
	// A read: actuality doesn't retain a blip, so it doesn't record the batch as a step, whose events would reach the page
	// and draw a scene that then records what it drew.
	await conduit
		.follow(reads(RECORD_BLIPS_METHOD, { batch: { blips: batch, recorded: ring.recorded() } }), `blips: ${batch.length} occurrence(s)`)
		.catch((e: unknown) => reportToRun("warn", "client-blips", `a batch holding ${batch.length} of the page's occurrences wasn't delivered: ${errorDetail(e)}`));
}
