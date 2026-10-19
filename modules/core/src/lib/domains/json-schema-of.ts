/**
 * The memo for converting a Zod schema to JSON Schema.
 *
 * A conversion walks the whole schema and allocates objects during the walk. Every registry build converts the same schemas again,
 * since registering steppers converts the domain of every typed parameter. A schema is a module-level constant, and its
 * conversion depends only on the schema. The memo computes each conversion once per process and returns the held
 * result after that.
 *
 * A caller names its conversion, because one schema converts differently for a caller's input than for a step's
 * output. The memo doesn't hold a conversion that throws, so the next caller receives the same error.
 */
import { z } from "zod";
import { zodTypeLabel } from "./zod-unwrap.js";

const held = new WeakMap<z.ZodType, Map<string, Record<string, unknown>>>();

export function jsonSchemaOf(schema: z.ZodType, conversion: string, convert: () => Record<string, unknown>): Record<string, unknown> {
	let byConversion = held.get(schema);
	if (byConversion === undefined) {
		byConversion = new Map<string, Record<string, unknown>>();
		held.set(schema, byConversion);
	}
	const hit = byConversion.get(conversion);
	if (hit !== undefined) return hit;
	const made = convert();
	byConversion.set(conversion, made);
	return made;
}

/**
 * Returns a schema as JSON Schema for discovery, MCP and forms. `io` selects the input a caller supplies or the output a
 * step returns. A date converts to an ISO date-time string. A field type without a JSON Schema form throws an error at
 * registration, and the error message names `subject` as the field's declaration.
 */
export function jsonSchemaFor(subject: string, schema: z.ZodType, io: "input" | "output"): Record<string, unknown> {
	return jsonSchemaOf(schema, io, () =>
		z.toJSONSchema(schema, {
			io,
			unrepresentable: "any",
			override: (ctx) => {
				const nodeType = zodTypeLabel(ctx.zodSchema);
				if (nodeType === "date") {
					ctx.jsonSchema.type = "string";
					ctx.jsonSchema.format = "date-time";
					return;
				}
				if (nodeType && UNREPRESENTABLE_ZOD_TYPES.has(nodeType)) {
					throw new Error(`${subject} declares a "${nodeType}" field. JSON Schema doesn't represent that type; declare the field with a type that JSON Schema represents`);
				}
			},
		}),
	);
}

/** Zod types without a JSON Schema representation. A date isn't listed, since it converts to a date-time string. A
 * domain that declares one of these types can't have a form or client-side validation, so registration throws. */
const UNREPRESENTABLE_ZOD_TYPES = new Set(["bigint", "symbol", "undefined", "void", "never", "function", "map", "set", "promise", "custom", "file"]);
