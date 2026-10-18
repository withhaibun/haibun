/**
 * Composite-domain introspection reads the fields of a registered domain's
 * Zod schema for the goal resolver's backward-chaining recursion.
 *
 * A domain whose Zod schema is a `z.object(...)` is called *composite*. Each
 * of the object's fields can be:
 *   - a *primitive* (string / number / boolean / literal / enum / bigint / date)
 *   - another registered domain, declared via `topology.ranges[field]`
 *
 * `getCompositeFields(domain, registry)` returns the per-field decomposition
 * for a composite domain (or `null` if the domain isn't composite). The goal
 * resolver calls it to determine whether to recurse into a field or treat the
 * field as a leaf argument.
 *
 * `topology.ranges` declares the link from a Zod field to another domain. It
 * is the haibun equivalent of SHACL's `sh:node` and RDFS's `rdfs:range`.
 * Domain matching doesn't use Zod-instance identity. That identity differs
 * across module copies and changes when a schema is cloned. The resolver
 * binds a field without a registered range in `ranges` as a
 * `kind: "argument"` binding.
 */
import { unwrap, unwrapToShape } from "./zod-unwrap.js";
import { z } from "zod";
import type { TRegisteredDomain } from "../resources.js";

/** Decomposition of one field within a composite domain. */
export type TCompositeField = {
	/** Field name within the parent Zod object. */
	fieldName: string;
	/** The field's Zod type, after unwrapping optional / nullable / default wrappers. */
	zodType: z.ZodType;
	/**
	 * The registered domain key that the parent domain's
	 * `topology.ranges[fieldName]` names. It is `undefined` where that entry is
	 * absent or names an unregistered domain.
	 */
	fieldDomain?: string;
	/** Whether the field's Zod type is a primitive scalar (string, number, boolean, literal, enum, bigint, date). */
	primitive: boolean;
	/** Whether the field is marked optional in the Zod schema. */
	optional: boolean;
};

/** Returns whether a Zod type is a primitive scalar. */
export function isPrimitiveZodType(zodType: z.ZodType): boolean {
	const def = (zodType as { _zod?: { def?: { type?: string } } })._zod?.def;
	if (!def?.type) return false;
	return def.type === "string" || def.type === "number" || def.type === "boolean" || def.type === "literal" || def.type === "enum" || def.type === "bigint" || def.type === "date";
}

/** Returns a short display label for a Zod type, such as "string", "number", "date", "array", "object" or "enum". Returns
 *  an empty string where the value doesn't carry a Zod def type. The parameter is unknown so that zod-core values don't
 *  need a cast; a toJSONSchema override's ctx.zodSchema is one such value. */
export function zodTypeLabel(zodType: unknown): string {
	const def = (zodType as { _zod?: { def?: { type?: string } } })?._zod?.def;
	return def?.type ?? "";
}

/**
 * Decomposes a registered domain into its component fields. Returns `null`
 * if the domain isn't registered or its schema isn't an object.
 *
 * `fieldDomain` holds the domain's `topology.ranges[fieldName]` where that
 * entry names a registered domain. A `ranges` entry that names an
 * unregistered domain leaves `fieldDomain` undefined without an error. The
 * resolver then binds the field as an argument.
 */
export function getCompositeFields(domainKey: string, registry: Record<string, TRegisteredDomain>): TCompositeField[] | null {
	const def = registry[domainKey];
	if (!def) return null;
	const shape = unwrapToShape(def.schema);
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
