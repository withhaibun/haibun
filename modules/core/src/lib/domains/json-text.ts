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
/** A JSON object, or JSON text that carries one. */
export const JsonObjectTextSchema = fromJsonText(JsonObjectSchema);

/** An object read by its keys, whatever its values hold. */
export const RecordSchema = z.record(z.string(), z.unknown());
export const RecordsSchema = z.array(RecordSchema);

/** Whether a value is an object read by its keys, checked without copying it, for a value a schema has already checked or
 *  that `JSON.parse` returned. */
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A value as an object read by its keys, checked without copying it; a value that isn't one is refused, named `what`. */
export function recordOf(value: unknown, what: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${what} isn't an object: ${Array.isArray(value) ? "array" : typeof value}`);
	return value;
}
