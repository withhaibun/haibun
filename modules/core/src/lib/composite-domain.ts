/**
 * Composite-domain introspection — bridge between Zod schemas, registered
 * domains, and the goal resolver's backward-chaining recursion.
 *
 * A domain whose Zod schema is a `z.object(...)` is called *composite*. Each
 * of the object's fields can be:
 *   - a *primitive* (string / number / boolean / literal / enum)
 *   - another registered domain, declared via `topology.ranges[field]`
 *
 * `getCompositeFields(domain, registry)` returns the per-field decomposition
 * for a composite domain (or `null` if the domain isn't composite). The
 * resolver, the chain-view, and the affordance frontier all consume this to
 * decide whether to recurse into a field or treat it as a leaf argument.
 *
 * The link from a Zod field to another domain is *declarative*: it lives in
 * `topology.ranges` (the haibun equivalent of SHACL's `sh:node` / RDFS's
 * `rdfs:range`). Zod-instance identity is NOT used as a domain match — it's
 * brittle across module copies and silently breaks when a schema is cloned.
 * `ranges` is the explicit channel; everything that isn't declared there is
 * treated as a primitive (resolves to a `kind: "argument"` binding).
 */
import { z } from "zod";
import type { TRegisteredDomain } from "./resources.js";

/** Decomposition of one field within a composite domain. */
export type TCompositeField = {
	/** Field name within the parent Zod object. */
	fieldName: string;
	/** The field's Zod type, after unwrapping optional / nullable / default wrappers. */
	zodType: z.ZodType;
	/**
	 * Registered domain key the field's value ranges over, or `undefined` for
	 * primitives and unmatched fields. Read from the parent domain's
	 * `topology.ranges[fieldName]`.
	 */
	fieldDomain?: string;
	/** Whether the field's Zod type is a primitive scalar (string, number, boolean, literal, enum). */
	primitive: boolean;
	/** Whether the field is marked optional in the Zod schema. */
	optional: boolean;
};

/** Inspect a Zod type to determine whether it represents a primitive scalar. */
export function isPrimitiveZodType(zodType: z.ZodType): boolean {
	const def = (zodType as { _zod?: { def?: { type?: string } } })._zod?.def;
	if (!def?.type) return false;
	return def.type === "string" || def.type === "number" || def.type === "boolean" || def.type === "literal" || def.type === "enum" || def.type === "bigint" || def.type === "date";
}

/** Short display label for a Zod type — "string", "number", "date", "array", "object", "enum", etc. Empty when undetectable. */
export function zodTypeLabel(zodType: z.ZodType): string {
	const def = (zodType as { _zod?: { def?: { type?: string } } })._zod?.def;
	return def?.type ?? "";
}

/** Strip optional / nullable / default wrappers to reveal the underlying Zod type. Tracks whether the field was optional. */
function unwrap(zodType: z.ZodType): { inner: z.ZodType; optional: boolean } {
	let current: z.ZodType = zodType;
	let optional = false;
	for (;;) {
		const def = (current as { _zod?: { def?: { type?: string; innerType?: z.ZodType } } })._zod?.def;
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
		return { inner: current, optional };
	}
}

/** Return the object-shape map for a Zod object, after wrapper unwrapping; `null` for non-objects. */
function objectShape(zodType: z.ZodType): Record<string, z.ZodType> | null {
	const { inner } = unwrap(zodType);
	const def = (inner as { _zod?: { def?: { type?: string; shape?: Record<string, z.ZodType> } } })._zod?.def;
	if (def?.type === "object" && def.shape) return def.shape;
	// Zod v4 ZodObject also exposes .shape directly.
	if ("shape" in inner) {
		const shape = (inner as { shape: unknown }).shape;
		if (shape && typeof shape === "object") return shape as Record<string, z.ZodType>;
	}
	return null;
}

/**
 * Decompose a registered domain into its component fields, or return `null`
 * if the domain isn't composite (schema isn't an object, or isn't registered).
 *
 * `fieldDomain` is populated from the domain's `topology.ranges[fieldName]`
 * when present and the named domain is itself registered. Unrecognised
 * `ranges` entries are dropped silently and the field falls back to primitive.
 */
export function getCompositeFields(domainKey: string, registry: Record<string, TRegisteredDomain>): TCompositeField[] | null {
	const def = registry[domainKey];
	if (!def) return null;
	const shape = objectShape(def.schema);
	if (!shape) return null;
	const ranges = def.topology?.ranges ?? {};
	const out: TCompositeField[] = [];
	for (const [fieldName, rawType] of Object.entries(shape)) {
		const { inner, optional } = unwrap(rawType);
		const declaredRange = ranges[fieldName];
		const fieldDomain = declaredRange && registry[declaredRange] ? declaredRange : undefined;
		out.push({ fieldName, zodType: inner, fieldDomain, primitive: isPrimitiveZodType(inner), optional });
	}
	return out;
}
