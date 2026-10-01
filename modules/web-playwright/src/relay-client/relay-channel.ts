/**
 * A channel to an instance's browser relay over its `/rpc`: `relay.attach` is held open as a streamed call, and its
 * stream carries the relay's commands; `relay.send` carries what the extension returns back, the messages of one turn in
 * one call, after the calls before it. Each call is signed by `sign`, which is the extension's key signing under its
 * delegation. The channel opens once the relay states it holds the extension, and a refused attachment throws its
 * refusal, as does an attachment the relay doesn't open within `RELAY_OPEN_MS`.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { actualityAt, postRpc, readNdjson, type TProveRequest } from "@haibun/core/lib/rpc-wire.js";
import type { TStreamChunk } from "@haibun/core/lib/step-stream-context.js";
import { RELAY_ATTACHED, RELAY_METHOD_PREFIX, RELAY_OPEN_MS, type TRelayBatch, type TRelayCall, type TRelayMessage } from "../relay/relay-wire.js";
import type { TRelayChannel } from "./relayConnection.js";

export async function openRelayChannel({ base, sign }: { base: string; sign: TProveRequest }): Promise<TRelayChannel> {
	// The channel drives the actuality the instance holds as it opens, and its calls are refused once that changes.
	const actualityId = await actualityAt(base);
	const call = async (relayCall: TRelayCall, params: Record<string, unknown>, stream?: { signal: AbortSignal }): Promise<Response> => {
		const method = `${RELAY_METHOD_PREFIX}${relayCall}`;
		const answer = await postRpc(base, actualityId, method, params, sign, stream);
		if (!answer.ok) throw new Error(`${method} was refused (${answer.status}): ${await answer.text()}`);
		return answer;
	};
	const ending = new AbortController();
	const unopened = new Error(`relay.attach at ${base} didn't state that it holds the extension within ${RELAY_OPEN_MS}ms`);
	const bound = setTimeout(() => ending.abort(unopened), RELAY_OPEN_MS);
	const attach = async (): Promise<AsyncGenerator<TStreamChunk, void, unknown>> => {
		const attached = await call("attach", {}, { signal: ending.signal });
		if (!attached.body) throw new Error("relay.attach returned a response without a stream to carry the relay's commands");
		const chunks = readNdjson<TStreamChunk>(attached.body);
		const first = await chunks.next();
		const opening = first.done ? undefined : first.value;
		if (!opening || opening.error || (opening.message as TRelayMessage | undefined)?.method !== RELAY_ATTACHED)
			throw new Error(`relay.attach was refused: ${opening ? (opening.error ?? JSON.stringify(opening)) : "the stream ended before the relay held the extension"}`);
		return chunks;
	};
	const chunks = await attach().then(
		(opened) => {
			clearTimeout(bound);
			return opened;
		},
		(e: unknown) => {
			clearTimeout(bound);
			const timedOut = ending.signal.reason === unopened;
			ending.abort();
			throw timedOut ? unopened : e;
		},
	);

	let open = true;
	let held: TRelayMessage[] = [];
	let sending: Promise<void> = Promise.resolve();
	const channel: TRelayChannel = {
		get open() {
			return open;
		},
		send(message) {
			held.push(message);
			if (held.length > 1) return;
			queueMicrotask(() => {
				const batch: TRelayBatch = { messages: held };
				held = [];
				// The first failed send ends the channel, so the channel doesn't send a message after one the relay didn't take.
				sending = sending.then(() => call("send", batch)).then((): undefined => undefined);
				sending.catch((e: unknown) => channel.close(`relay.send failed: ${errorDetail(e)}`));
			});
		},
		close(reason) {
			if (!open) return;
			open = false;
			ending.abort(reason);
			channel.onclose?.(reason);
		},
	};
	void (async () => {
		try {
			for await (const chunk of chunks) {
				if (chunk.error) throw new Error(chunk.error);
				if (chunk.message) channel.onmessage?.(chunk.message as TRelayMessage);
			}
		} catch (e) {
			if (open) channel.close(`the relay ended the attachment: ${errorDetail(e)}`);
		}
		channel.close("the relay ended the attachment");
	})();
	return channel;
}
