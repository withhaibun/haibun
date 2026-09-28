/**
 * The channel an extension attaches through opens once the relay states it holds the extension. An attach the relay
 * doesn't open is refused at `RELAY_OPEN_MS`, so the extension states why rather than waiting on a call that doesn't
 * return.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RELAY_OPEN_MS } from "../relay/relay-wire.js";
import { openRelayChannel } from "./relay-channel.js";

const BASE = "http://instance.test:8123";
const sign = (request: { headers: Record<string, string> }): Promise<Record<string, string>> => Promise.resolve(request.headers);
const UNOPENED = new RegExp(`didn't state that it holds the extension within ${RELAY_OPEN_MS}ms`);

/** A fetch that doesn't settle until its call is aborted, and then rejects with the abort's reason. */
const unansweredFetch = (_url: string, init: { signal?: AbortSignal }): Promise<Response> =>
	new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));

/** A fetch whose response stream doesn't carry a chunk until its call is aborted, and then errors. */
const silentStreamFetch = (_url: string, init: { signal?: AbortSignal }): Promise<Response> =>
	Promise.resolve(new Response(new ReadableStream({ start: (controller) => init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason)) })));

describe("opening a relay channel", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it.each([
		["the relay doesn't respond to the attach call", unansweredFetch],
		["the relay's stream doesn't carry its opening message", silentStreamFetch],
	])("refuses an attach at the bound where %s", async (_, fetch) => {
		vi.stubGlobal("fetch", fetch);
		const opening = openRelayChannel({ base: BASE, sign });
		const refused = expect(opening).rejects.toThrow(UNOPENED);
		await vi.advanceTimersByTimeAsync(RELAY_OPEN_MS);
		await refused;
	});
});
