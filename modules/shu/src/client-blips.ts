import { pagePinned } from "./page-pinned.js";
import { isOffline } from "./rpc-registry.js";
/**
 * The browser side of the blip channel.
 *
 * A component records where the thing happens, at whatever rate it happens, including every frame. Recording holds the
 * occurrence in a fixed ring and returns. It doesn't send a request or allocate beyond the occurrence itself, and holds
 * constant memory however long the page stays open. What the ring drops is counted, so a batch never presents a truncation as the whole.
 *
 * Occurrences leave in batches over the one bridge that exists, `MonitorStepper`, rather than one request each, which
 * is the only way a per-frame recording is sustainable. A batch is sent only when there is something to send, so a page
 * without occurrences doesn't send a batch. On actuality's side each occurrence lands in the same channel a server-side
 * recording does, where it is one check while the channel doesn't have a subscriber.
 */
import { conduit, hasConduit, reads } from "./hypermedia.js";
import { reportToRun } from "./client-log.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";

/** How many occurrences the browser holds between batches. Fixed, so the buffer cannot grow while a batch is in flight. */
export const CLIENT_RING = 240;

/** How long to wait before sending, so a burst of frames leaves as one batch rather than one request per frame. */
const FLUSH_DELAY_MS = 250;

type TClientBlip = { name: string; value?: number; attributes?: Record<string, unknown>; at: number };

/** The page's one buffer of occurrences, which every bundle on the page records into and sends from. */
type TBlipBuffer = { ring: TClientBlip[]; at: number; recorded: number; sent: number; timer?: ReturnType<typeof setTimeout> };
const BLIPS_KEY = "__SHU_CLIENT_BLIPS__";
const buffer = (): TBlipBuffer =>
	pagePinned<TBlipBuffer>(
		BLIPS_KEY,
		() => ({ ring: [], at: 0, recorded: 0, sent: 0 }),
		(held) => clearTimeout(held.timer),
	);

/**
 * Record one occurrence. This is the hot path: it holds the occurrence and returns, and is meant to be called
 * unconditionally from wherever the thing being observed happens.
 */
export function recordClientBlip(name: string, value?: number, attributes?: Record<string, unknown>): void {
	const held = buffer();
	held.recorded++;
	const blip: TClientBlip = { name, value, attributes, at: Date.now() };
	if (held.ring.length < CLIENT_RING) held.ring.push(blip);
	else {
		held.ring[held.at] = blip;
		held.at = (held.at + 1) % CLIENT_RING;
	}
	scheduleFlush(held);
}

/** Every occurrence recorded since the page loaded, including any a full ring dropped before it could be sent. */
export function clientBlipsRecorded(): number {
	return buffer().recorded;
}

/** Occurrences handed to actuality so far. */
export function clientBlipsSent(): number {
	return buffer().sent;
}

function scheduleFlush(held: TBlipBuffer): void {
	// A page that doesn't have a run for its batches (offline, or mounted without a conduit) holds what it records and doesn't send a batch.
	if (held.timer || isOffline() || !hasConduit()) return;
	held.timer = setTimeout(() => {
		held.timer = undefined;
		void flushClientBlips();
	}, FLUSH_DELAY_MS);
}

/** Hand everything held to actuality as one batch. Exported so a test can flush without waiting for the timer. */
export async function flushClientBlips(): Promise<void> {
	const held = buffer();
	const batch = takeHeld(held);
	if (batch.length === 0) return;
	held.sent += batch.length;
	// A dropped batch is a lost observation, never a broken page: actuality keeps its own count of what it received, and
	// the occurrence was by definition one actuality does not retain.
	// A read, not an act: actuality doesn't retain a blip, so a batch's arrival is not recorded as a step. A recorded
	// batch would be a step whose events reach the page and repaint a scene that then records what it drew.
	await conduit()
		.follow(reads("MonitorStepper-recordClientBlips", { batch: { blips: batch, recorded: held.recorded } }), `blips: ${batch.length} occurrence(s)`)
		.catch((e: unknown) => reportToRun("warn", "client-blips", `a batch holding ${batch.length} of the page's occurrences wasn't delivered: ${errorDetail(e)}`));
}

function takeHeld(held: TBlipBuffer): TClientBlip[] {
	const taken = held.ring.length < CLIENT_RING ? held.ring : [...held.ring.slice(held.at), ...held.ring.slice(0, held.at)];
	held.ring = [];
	held.at = 0;
	return taken;
}
