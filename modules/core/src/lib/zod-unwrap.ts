/**
 * The one walk through zod's wrapper types.
 *
 * `optional`, `nullable` and `default` each wrap the type they qualify. A preprocess wraps the type that parses its
 * transformed input. A reader of the underlying type walks through these wrappers. The walk reads zod's private
 * `_zod.def`. A zod version may move it, and this module is the one place to correct when the library changes.
 */
import type { z } from "zod";

type TWrapperDef = { type?: string; innerType?: z.ZodType; in?: z.ZodType; out?: z.ZodType };

/** Returns the definition zod holds in `_zod.def` for every type, including a type that isn't a wrapper. Returns undefined
 *  where the type doesn't carry `_zod.def`. */
const wrapperDef = (t: z.ZodType): TWrapperDef | undefined => (t as { _zod?: { def?: TWrapperDef } })._zod?.def;

/** Walks through optional, nullable, default and preprocess wrappers and returns the underlying type. It also returns
 *  whether an optional or nullable wrapper is present. A preprocess is a pipe from a transform into the type its value
 *  takes. */
export function unwrap(zodType: z.ZodType): { inner: z.ZodType; optional: boolean } {
	let current: z.ZodType = zodType;
	let optional = false;
	for (;;) {
		const def = wrapperDef(current);
		if (!def) return { inner: current, optional };
		if (def.type === "optional" || def.type === "nullable") {
			optional = true;
			if (def.innerType) {
				current = def.innerType;
				continue;
			}
		}
		if (def.type === "default" && def.innerType) {
			current = def.innerType;
			continue;
		}
		if (def.type === "pipe" && def.in && def.out && wrapperDef(def.in)?.type === "transform") {
			current = def.out;
			continue;
		}
		return { inner: current, optional };
	}
}

/** The object type under a type's wrappers, or null where it isn't an object. */
export function unwrapToObject(zodType: z.ZodType): z.ZodObject | null {
	const { inner } = unwrap(zodType);
	return wrapperDef(inner)?.type === "object" ? (inner as z.ZodObject) : null;
}

/** The shape of the object under a type's wrappers, or null where it isn't an object. */
export function unwrapToShape(zodType: z.ZodType): Record<string, z.ZodType> | null {
	return unwrapToObject(zodType)?.shape ?? null;
}
