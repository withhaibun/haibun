/**
 * Tests the wrapper walk over the nestings that occur: a default over an optional over an object, a preprocess over
 * the type that parses its output, and the object itself. The walk reads zod's private `_zod.def`, and a zod version
 * may move it. These tests run against the installed zod, so a version that moves it fails a test instead of leaving a
 * wrapper in place without an error.
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
		expect(got.inner.constructor.name, "unwrap returns the string type under the wrappers").toBe(z.string().constructor.name);
		expect(got.optional, "optional is true where an optional or nullable wrapper is present").toBe(optional);
	});

	it("returns an object unchanged because an object isn't a wrapper", () => {
		expect(unwrap(objectType).inner).toBe(objectType);
	});

	it("returns a transform's pipe unchanged because its output isn't the type it reads", () => {
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

	it("returns null where the schema doesn't have a shape", () => {
		expect(unwrapToShape(z.string())).toBeNull();
		expect(unwrapToShape(z.number().optional())).toBeNull();
	});
});
