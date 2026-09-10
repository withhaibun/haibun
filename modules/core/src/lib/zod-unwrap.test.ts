/**
 * The wrapper walk, over the nestings that occur: a default over an optional over an object, and the object itself.
 * Written three times, one copy reached zod's older `_def.innerType` while the others reached `_zod.def`, so on the
 * installed zod that copy returned the wrapper it was asked to remove and reported nothing. These assert the walk
 * against the library installed, which is what makes a version move a failing test rather than a silence.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { unwrap, unwrapToShape } from "./zod-unwrap.js";

const objectType = z.object({ a: z.string(), b: z.number() });

describe("unwrap", () => {
	it.each([
		["a bare type", z.string(), false],
		["optional", z.string().optional(), true],
		["nullable", z.string().nullable(), true],
		["default", z.string().default("x"), false],
		["default over optional", z.string().optional().default("x"), true],
		["optional over nullable", z.string().nullable().optional(), true],
	])("reaches the underlying type through %s", (_name, schema, optional) => {
		const got = unwrap(schema as z.ZodType);
		expect(got.inner.constructor.name, "the wrapper is gone").toBe(z.string().constructor.name);
		expect(got.optional, "and it says whether a wrapper made the field optional").toBe(optional);
	});

	it("leaves an object alone, since an object is not a wrapper", () => {
		expect(unwrap(objectType).inner).toBe(objectType);
	});
});

describe("unwrapToShape", () => {
	it("reads the shape through the wrappers a field may carry", () => {
		for (const schema of [objectType, objectType.optional(), objectType.default({ a: "", b: 0 }), objectType.nullable().optional()]) {
			expect(Object.keys(unwrapToShape(schema as z.ZodType) ?? {})).toEqual(["a", "b"]);
		}
	});

	it("answers null where there is no shape to read", () => {
		expect(unwrapToShape(z.string())).toBeNull();
		expect(unwrapToShape(z.number().optional())).toBeNull();
	});
});
