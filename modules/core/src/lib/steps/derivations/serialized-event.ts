/**
 * An event as JSON text, serialized once. The events hub writes the text to its sink, and each transport that sends the
 * event reads the same text, so an event is serialized once whatever the count of its readers.
 */
import type { THaibunEvent } from "../../../schema/protocol.js";

/** Each event's text, held while the event is held. */
const serialized = new WeakMap<THaibunEvent, string>();

/** An event as JSON text. Throws where the event doesn't serialize, as JSON.stringify throws for a text longer than its limit. */
export function serializedEvent(event: THaibunEvent): string {
	const held = serialized.get(event);
	if (held !== undefined) return held;
	const text = JSON.stringify(event);
	serialized.set(event, text);
	return text;
}
