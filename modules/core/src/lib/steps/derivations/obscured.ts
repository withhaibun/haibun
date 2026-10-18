/**
 * An event with each secret value it states replaced by the obscured value. The events hub obscures an event once, so
 * every subscriber and every sink receives it obscured.
 */
import type { THaibunEvent } from "../../domains/protocol.js";
import { OBSCURED_VALUE } from "../domains/secrets.js";

/** A text with each secret value it holds replaced by the obscured value. An empty value doesn't name a secret. */
export const obscuredText = (text: string, secrets: readonly string[]): string =>
	secrets.reduce((obscured, secret) => (secret === "" ? obscured : obscured.replaceAll(secret, OBSCURED_VALUE)), text);

/** A value with every text it holds obscured, at any depth of its lists and objects. */
export function obscuredValue(value: unknown, secrets: readonly string[]): unknown {
	if (typeof value === "string") return obscuredText(value, secrets);
	if (Array.isArray(value)) return value.map((item) => obscuredValue(item, secrets));
	if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, obscuredValue(item, secrets)]));
	return value;
}

/** An event with each secret value obscured in a log's message and its attributes. An event of another kind is returned
 *  unchanged, as is every event while actuality doesn't hold a secret. */
export function obscuredEvent(event: THaibunEvent, secrets: readonly string[]): THaibunEvent {
	if (event.kind !== "log" || secrets.length === 0) return event;
	const { attributes } = event;
	return { ...event, message: obscuredText(event.message, secrets), ...(attributes === undefined ? {} : { attributes: obscuredValue(attributes, secrets) as typeof attributes }) };
}
