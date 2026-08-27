import { isOffline } from "./rpc-registry.js";
/**
 * The browser side of the blip channel.
 *
 * A component records where the thing happens, at whatever rate it happens, including every frame. Recording holds the
 * occurrence in a fixed ring and returns: no request, no allocation beyond the occurrence itself, and constant memory
 * however long the page stays open. What the ring drops is counted, so a batch never presents a truncation as the whole.
 *
 * Occurrences leave in batches over the one bridge that exists, `MonitorStepper`, rather than one request each, which
 * is the only way a per-frame recording is affordable. A batch is sent only when there is something to send, so a page
 * where nothing happens costs nothing. On the run's side each occurrence lands in the same channel a server-side
 * recording does, where it costs one check when nothing is watching.
 */
import { conduit, } from "./hypermedia.js";

/** How many occurrences the browser holds between batches. Fixed, so the buffer cannot grow while a batch is in flight. */
export const CLIENT_RING = 240;

/** How long to wait before sending, so a burst of frames leaves as one batch rather than one request per frame. */
export const FLUSH_DELAY_MS = 250;

export type TClientBlip = { name: string; value?: number; attributes?: Record<string, unknown>; at: number };

let ring: TClientBlip[] = [];
let at = 0;
let recorded = 0;
let sent = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Record one occurrence. This is the hot path: it holds the occurrence and returns, and is meant to be called
 * unconditionally from wherever the thing being observed actually happens.
 */
export function recordClientBlip(name: string, value?: number, attributes?: Record<string, unknown>): void {
	recorded++;
	const blip: TClientBlip = { name, value, attributes, at: Date.now() };
	if (ring.length < CLIENT_RING) ring.push(blip);
	else {
		ring[at] = blip;
		at = (at + 1) % CLIENT_RING;
	}
	scheduleFlush();
}

/** Every occurrence recorded since the page loaded, including any a full ring dropped before it could be sent. */
export function clientBlipsRecorded(): number {
	return recorded;
}

/** Occurrences handed to the run so far. */
export function clientBlipsSent(): number {
	return sent;
}

/** Drop what is held and forget the counts. For a test, and for a page that is starting over. */
export function resetClientBlips(): void {
	if (timer) clearTimeout(timer);
	timer = undefined;
	ring = [];
	at = 0;
	recorded = 0;
	sent = 0;
}

function scheduleFlush(): void {
	if (timer || isOffline()) return;
	timer = setTimeout(() => {
		timer = undefined;
		void flushClientBlips();
	}, FLUSH_DELAY_MS);
}

/** Hand everything held to the run as one batch. Exported so a test can flush without waiting for the timer. */
export async function flushClientBlips(): Promise<void> {
	const batch = takeHeld();
	if (batch.length === 0) return;
	sent += batch.length;
	// A dropped batch is a lost observation, never a broken page: the run keeps its own count of what it received, and
	// the occurrence was by definition one the run does not retain.
	await conduit()
		.follow({ method: "MonitorStepper-recordClientBlips", params: { batch: { blips: batch, recorded } } }, `blips: ${batch.length} occurrence(s)`)
		.catch((e) => console.warn("[shu] blip batch not delivered", e));
}

function takeHeld(): TClientBlip[] {
	const held = ring.length < CLIENT_RING ? ring : [...ring.slice(at), ...ring.slice(0, at)];
	ring = [];
	at = 0;
	return held;
}
