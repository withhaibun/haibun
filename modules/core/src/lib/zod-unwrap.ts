/**
 * The one walk through zod's wrapper types.
 *
 * `optional`, `nullable` and `default` each wrap the type they qualify, and a preprocess wraps the type it reads its
 * input into, so every reader that wants the underlying type has to walk through them. Written three times, two of
 * them reached different private zod internals, `_zod.def` and `_def.innerType`, so a zod version that moves one
 * leaves the other returning an unpeeled type without reporting it. One walk, one place to correct when the
 * library moves.
 */
import type { z } from "zod";

type TWrapperDef = { type?: string; innerType?: z.ZodType; in?: z.ZodType; out?: z.ZodType };

/** The wrapper definition zod holds for a type, or undefined where the type is not a wrapper. */
const wrapperDef = (t: z.ZodType): TWrapperDef | undefined => (t as { _zod?: { def?: TWrapperDef } })._zod?.def;

/** Strip optional / nullable / default / preprocess wrappers to reveal the underlying type, returning whether any made it
 *  optional. A preprocess is a pipe from a transform into the type its value takes. */
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

/** The object type a type is once unwrapped, or null where it is not an object. */
export function unwrapToObject(zodType: z.ZodType): z.ZodObject | null {
	const { inner } = unwrap(zodType);
	return wrapperDef(inner)?.type === "object" ? (inner as z.ZodObject) : null;
}

/** The object shape a type carries once unwrapped, or null where it is not an object. */
export function unwrapToShape(zodType: z.ZodType): Record<string, z.ZodType> | null {
	return unwrapToObject(zodType)?.shape ?? null;
}
