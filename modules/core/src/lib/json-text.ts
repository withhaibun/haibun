import { z } from "zod";

/** JSON text's value. Text that isn't JSON is refused through `ctx`, with the parser's reason and the text. */
export function parseJsonText(text: string, ctx: z.RefinementCtx): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch (e) {
		ctx.addIssue({ code: "custom", message: `is text that isn't JSON (${(e as Error).message}): ${text.slice(0, 120)}` });
		return z.NEVER;
	}
}

/** The value text carries as JSON, or undefined where the text isn't JSON: for text that may or may not carry it, such as
 *  what a reader wrote, a cookie, or an attribute of sanitized markup. */
export function jsonCarried(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

/**
 * A schema that also takes its value as JSON text, the form a feature line writes a composite in: text is parsed and then
 * checked by `schema`. Text that isn't JSON is refused there, before anything else is checked. Its JSON Schema is
 * `schema`'s, the form a call sends.
 */
export function fromJsonText<T extends z.ZodType>(schema: T) {
	return z.preprocess((value, ctx) => (typeof value === "string" ? parseJsonText(value, ctx) : value), schema);
}

/** A JSON object read whole, as a record's JSON body or a signed document holds one. */
export const JsonObjectSchema = z.record(z.string(), z.json());
