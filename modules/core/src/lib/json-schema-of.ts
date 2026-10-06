/**
 * One memo for turning a Zod schema into JSON Schema.
 *
 * A conversion walks the whole schema and allocates as it goes, and the same schemas are converted again on every
 * registry build: registering a run's steppers converts every typed parameter's domain, and the walk allocates as it
 * goes. A schema is a module-level constant and a conversion of one is a function of the schema, so it is computed
 * once per process and read back after.
 *
 * A caller names its conversion, since one schema converts differently for what a caller must supply than for what a
 * step answers with. A conversion that throws isn't held, so the next caller is told the same thing.
 */
import { z } from "zod";
import { zodTypeLabel } from "./composite-domain.js";

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
 * A schema as JSON Schema, for discovery, MCP and forms: what a caller supplies, or what a step answers. A date is an ISO
 * date-time string, and a type without a JSON Schema form is refused at registration, naming `subject`, what declares it.
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
					throw new Error(`${subject} declares a "${nodeType}" field, which doesn't have a JSON Schema form; declare a representable type`);
				}
			},
		}),
	);
}

/** Zod types without a JSON Schema representation (dates excepted: they surface as string/date-time). A domain
 * declaring one of these doesn't have a form or a client-side validation surface, so registration throws. */
const UNREPRESENTABLE_ZOD_TYPES = new Set(["bigint", "symbol", "undefined", "void", "never", "function", "map", "set", "promise", "custom", "file"]);
