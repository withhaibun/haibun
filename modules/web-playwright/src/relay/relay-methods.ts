/**
 * The `/rpc` family an extension attaches a browser through: `relay.attach` is a streamed call held open for the length
 * of the attachment, which carries each command for the extension as a message of its stream, and `relay.send` carries
 * the extension's answers and its tabs' events back. Both require the action a delegation names to attach a browser, and
 * only the key that attached the browser sends for it.
 */
import { streamContext } from "@haibun/core/lib/step-stream-context.js";
import { actingAs } from "@haibun/core/lib/capability-context.js";
import type { TRpcMethod } from "@haibun/core/lib/rpc-wire.js";
import type { BrowserRelay } from "./cdpRelay.js";
import { RELAY_ATTACHED, RelayBatchSchema, type TRelayCall, type TRelayMessage } from "./relay-wire.js";

export function relayMethods(relay: BrowserRelay, attachAction: string): Record<TRelayCall, TRpcMethod> {
	return {
		attach: {
			action: attachAction,
			handle: async () => {
				const stream = streamContext.getStore();
				if (!stream) throw new Error("relay.attach is held open as a streamed call, which carries the relay's commands to the extension");
				await relay.attach(
					(message: TRelayMessage) => stream.emit({ message }),
					stream.signal,
					() => stream.emit({ message: { method: RELAY_ATTACHED } }),
					actingAs(),
				);
				return { detached: true };
			},
		},
		send: {
			action: attachAction,
			handle: (params) => {
				const { messages } = RelayBatchSchema.parse(params);
				relay.receive(messages, actingAs());
				return Promise.resolve({ received: messages.length });
			},
		},
	};
}
