/**
 * One memo for turning a Zod schema into JSON Schema.
 *
 * A conversion walks the whole schema and allocates as it goes, and the same schemas are converted again on every
 * registry build: registering a run's steppers converts every typed parameter's domain, and the walk allocates as it
 * goes. A schema is a module-level constant and a conversion of one is a function of the schema, so it is computed
 * once per process and read back after.
 *
 * A caller names its conversion, since one schema converts differently for what a caller must supply than for what a
 * step answers with. A conversion that throws holds nothing, so the next caller is told the same thing.
 */
import type { z } from "zod";

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
