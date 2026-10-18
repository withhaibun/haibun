/**
 * The event stream's writes to a follower: each is awaited, a follower that reads late but within the count of writes in
 * flight is kept and receives every event, and a follower that stops reading past the count is ended (CP7R4).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTUALITY_HEADER, SSE_ROUTE } from "@haibun/core/lib/rpc-wire.js";
import { FOLLOWS_THE_RUN } from "@haibun/core/lib/domains/actions.js";
import { Access } from "@haibun/core/lib/domains/resources.js";
import { LogEvent } from "@haibun/core/lib/domains/protocol.js";
import { eventHubOfTest, getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { storeDeclaring } from "@haibun/core/lib/test/declared-types.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { EndpointLabels } from "../domains/web-server.js";
import type { TCapabilityVerifier } from "../ports.js";
import { ServerHono } from "../adapters/server-hono.js";
import { SSETransport } from "./event-stream.js";

/** The writes a follower may hold in flight in these tests. */
const WRITES_IN_FLIGHT = 4;
/** How long a test lets the stream's writes settle while its follower doesn't read. */
const SETTLE_MS = 50;

/** A verifier that allows every request to follow at the public level. */
const following: TCapabilityVerifier = {
	authorityOf: () => Promise.resolve({ granted: [FOLLOWS_THE_RUN], held: [FOLLOWS_THE_RUN] }),
	allowing: () => Promise.resolve({ granted: [FOLLOWS_THE_RUN], held: [FOLLOWS_THE_RUN] }),
	delegateOf: () => undefined,
	endWhenLapsed: () => undefined,
};

const settled = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
const eventOf = (id: string) => LogEvent.parse({ id, timestamp: Date.now(), kind: "log", level: "info", message: id, accessLevel: Access.public });

/** Reads `count` messages from a stream's reader, or fewer where the stream ends first, and returns each event's id. */
async function idsRead(reader: ReadableStreamDefaultReader<Uint8Array>, count: number): Promise<{ ids: string[]; ended: boolean }> {
	const decoder = new TextDecoder();
	const ids: string[] = [];
	let held = "";
	while (ids.length < count) {
		const { value, done } = await reader.read();
		if (done) return { ids, ended: true };
		held += decoder.decode(value, { stream: true });
		const messages = held.split("\n\n");
		held = messages.pop() ?? "";
		for (const message of messages) {
			const data = message.split("\n").find((line) => line.startsWith("data: "));
			if (data) ids.push((JSON.parse(data.slice("data: ".length)) as { event: { id: string } }).event.id);
		}
	}
	return { ids, ended: false };
}

describe("the event stream's followers", () => {
	let world: TWorld;
	let server: ServerHono;
	let transport: SSETransport;

	beforeEach(() => {
		world = getDefaultWorld();
		const store = storeDeclaring({ [EndpointLabels.Endpoint]: {} });
		server = new ServerHono(eventHubOfTest(), "/tmp", () => store, [], []);
		transport = new SSETransport({ webserver: server, eventLogger: eventHubOfTest(), runtime: world.runtime, verifier: following, writesInFlight: WRITES_IN_FLIGHT });
	});
	afterEach(() => server.close());

	const follow = async () => {
		const res = await server.app.request(SSE_ROUTE, { headers: { [ACTUALITY_HEADER]: world.runtime.actualityId } });
		expect(res.status).toBe(200);
		if (!res.body) throw new Error("the stream's response doesn't carry a body");
		return res.body.getReader();
	};

	it("keeps a follower that reads late, within the count of writes in flight, and sends it every event in order", async () => {
		const reader = await follow();
		const sent = Array.from({ length: WRITES_IN_FLIGHT }, (_, at) => `late-${at}`);
		for (const id of sent) transport.sendEvent(eventOf(id));
		await settled();
		expect(await idsRead(reader, sent.length)).toEqual({ ids: sent, ended: false });
		transport.sendEvent(eventOf("after"));
		expect(await idsRead(reader, 1), "the follower that read late is still followed").toEqual({ ids: ["after"], ended: false });
		await reader.cancel();
	});

	it("ends a follower that stops reading past the count of writes in flight", async () => {
		const reader = await follow();
		const sent = Array.from({ length: WRITES_IN_FLIGHT * 4 }, (_, at) => `unread-${at}`);
		for (const id of sent) transport.sendEvent(eventOf(id));
		await settled();
		const read = await idsRead(reader, sent.length);
		expect(read.ended, "the stream ended the follower").toBe(true);
		expect(read.ids.length).toBeLessThan(sent.length);
		expect(read.ids).toEqual(sent.slice(0, read.ids.length));
	});
});
