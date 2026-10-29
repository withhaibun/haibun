import { z } from "zod";
import { navigateValue } from "./dot-path.js";

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

/** Returns a value as a refusal states it: a time as its instant, and any other value as its JSON, cut at 120 characters. */
function asWritten(value: unknown): string {
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? "a Date that doesn't hold a time" : value.toISOString();
	if (value === undefined) return "an absent value";
	const written = JSON.stringify(value);
	return written === undefined ? String(value) : written.length > 120 ? `${written.slice(0, 120)}…` : written;
}

/** Returns each field a schema refused, with the value written for it. */
export function refusedFields(error: z.ZodError, input: unknown): string {
	return error.issues
		.map((issue) => {
			const at = issue.path.map(String).join(".");
			const held = navigateValue(input, issue.path.map(String)).value;
			return `${at === "" ? "the record" : at} is ${asWritten(held)}, and ${issue.message.replace(/^Invalid input: /, "")}`;
		})
		.join("; ");
}

/** Returns what a type's schema parsed of a record, as the schema's output. A record the schema refuses is refused with each
 *  field's cause, so a store writes, and a read returns, only records that fit their type: `writing` names the write, else the read. */
export function parsedRecord<S extends z.ZodType>(schema: S, label: string, value: unknown, writing: boolean): z.output<S> {
	const parsed = schema.safeParse(value);
	if (parsed.success) return parsed.data;
	const act = writing ? `A write of a ${label} record is refused` : `A stored ${label} record is refused on read`;
	throw new Error(
		`${act}: ${refusedFields(parsed.error, value)}. ${writing ? "Write the fields as the type's schema states them" : "Correct the record to the type's schema, or write it again"}.`,
	);
}

/** Returns a record its type's schema parsed, as `parsedRecord` parses it, read by its fields. */
export const schemaRecord = (schema: z.ZodType, label: string, value: unknown, writing: boolean): Record<string, unknown> =>
	recordOf(parsedRecord(schema, label, value, writing), `a ${label} record`);
