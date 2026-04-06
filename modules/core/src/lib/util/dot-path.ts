import { z } from "zod";

/** Split a term like "result.total" into baseName and path segments. */
export function parseDotPath(term: string): { baseName: string; pathSegments: string[] } {
	const idx = term.indexOf(".");
	if (idx === -1) return { baseName: term, pathSegments: [] };
	return { baseName: term.slice(0, idx), pathSegments: term.slice(idx + 1).split(".") };
}

/** Navigate into a runtime value using path segments. */
export function navigateValue(value: unknown, segments: string[]): { value: unknown; found: boolean } {
	let current = value;
	for (const seg of segments) {
		if (current === null || current === undefined || typeof current !== "object") {
			return { value: undefined, found: false };
		}
		if (!(seg in (current as Record<string, unknown>))) {
			return { value: undefined, found: false };
		}
		current = (current as Record<string, unknown>)[seg];
	}
	return { value: current, found: true };
}

/** Validate a dot-path against a Zod schema. Returns the leaf type or null if path is invalid. */
export function validateZodPath(schema: z.ZodType, segments: string[]): z.ZodType | null {
	let current: z.ZodType = schema;
	for (const seg of segments) {
		// Unwrap wrappers to find the underlying object shape
		const inner = unwrapToShape(current);
		if (!inner || !(seg in inner)) return null;
		current = inner[seg] as z.ZodType;
	}
	return current;
}

/** Unwrap optional/nullable/default wrappers and extract object shape if present. */
function unwrapToShape(schema: z.ZodType): Record<string, z.ZodType> | null {
	const def = (schema as { _zod?: { def?: { type?: string; innerType?: z.ZodType; shape?: Record<string, z.ZodType> } } })._zod?.def;
	if (!def) return null;
	if (def.type === "object" && def.shape) return def.shape as Record<string, z.ZodType>;
	if ((def.type === "optional" || def.type === "nullable" || def.type === "default") && def.innerType) {
		return unwrapToShape(def.innerType);
	}
	// Zod v4 ZodObject has .shape directly
	if ("shape" in schema && typeof (schema as { shape: unknown }).shape === "object") {
		return (schema as { shape: Record<string, z.ZodType> }).shape;
	}
	return null;
}
