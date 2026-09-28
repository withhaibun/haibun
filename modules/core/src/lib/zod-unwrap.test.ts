/**
 * The wrapper walk, over the nestings that occur: a default over an optional over an object, a preprocess over the
 * type it reads into, and the object itself.
 * Written three times, one copy reached zod's older `_def.innerType` while the others reached `_zod.def`, so on the
 * installed zod that copy returned the wrapper it was asked to remove and didn't report an error. These assert the walk
 * against the library installed, which is what makes a version move a failing test rather than a silence.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { unwrap, unwrapToObject, unwrapToShape } from "./zod-unwrap.js";
import { fromJsonText } from "./json-text.js";

const objectType = z.object({ a: z.string(), b: z.number() });

describe("unwrap", () => {
	it.each([
		["a bare type", z.string(), false],
		["optional", z.string().optional(), true],
		["nullable", z.string().nullable(), true],
		["default", z.string().default("x"), false],
		["default over optional", z.string().optional().default("x"), true],
		["optional over nullable", z.string().nullable().optional(), true],
		["a preprocess", z.preprocess((value) => value, z.string()), false],
	])("reaches the underlying type through %s", (_name, schema, optional) => {
		const got = unwrap(schema as z.ZodType);
		expect(got.inner.constructor.name, "the wrapper is gone").toBe(z.string().constructor.name);
		expect(got.optional, "and it says whether a wrapper made the field optional").toBe(optional);
	});

	it("leaves an object alone, since an object is not a wrapper", () => {
		expect(unwrap(objectType).inner).toBe(objectType);
	});

	it("leaves a transform's pipe alone, since what it yields is not the type it reads", () => {
		const transformed = z.string().transform((text) => text.length);
		expect(unwrap(transformed).inner).toBe(transformed);
	});
});

describe("unwrapToShape", () => {
	it("reads the shape through the wrappers a field may carry", () => {
		for (const schema of [objectType, objectType.optional(), objectType.default({ a: "", b: 0 }), objectType.nullable().optional(), fromJsonText(objectType)]) {
			expect(Object.keys(unwrapToShape(schema as z.ZodType) ?? {})).toEqual(["a", "b"]);
		}
	});

	it("reads the object itself through a preprocess, so an object built on it keeps the object's settings", () => {
		const strict = objectType.strict();
		expect(unwrapToObject(fromJsonText(strict))).toBe(strict);
	});

	it("answers null where the schema doesn't have a shape to read", () => {
		expect(unwrapToShape(z.string())).toBeNull();
		expect(unwrapToShape(z.number().optional())).toBeNull();
	});
});
