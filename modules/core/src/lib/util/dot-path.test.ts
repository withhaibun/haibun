import { describe, it, expect } from "vitest";
import { parseDotPath, navigateValue, validateZodPath } from "./dot-path.js";
import { z } from "zod";

describe("parseDotPath", () => {
	it("returns no segments for simple terms", () => {
		expect(parseDotPath("foo")).toEqual({ baseName: "foo", pathSegments: [] });
	});
	it("splits on first dot", () => {
		expect(parseDotPath("result.total")).toEqual({ baseName: "result", pathSegments: ["total"] });
	});
	it("handles nested paths", () => {
		expect(parseDotPath("result.vertex.subject")).toEqual({ baseName: "result", pathSegments: ["vertex", "subject"] });
	});
	it("handles empty string", () => {
		expect(parseDotPath("")).toEqual({ baseName: "", pathSegments: [] });
	});
});

describe("navigateValue", () => {
	it("navigates into objects", () => {
		expect(navigateValue({ a: { b: 42 } }, ["a", "b"])).toEqual({ value: 42, found: true });
	});
	it("returns found:false for missing keys", () => {
		expect(navigateValue({ a: 1 }, ["b"])).toEqual({ value: undefined, found: false });
	});
	it("returns found:false for null", () => {
		expect(navigateValue(null, ["a"])).toEqual({ value: undefined, found: false });
	});
	it("returns found:false for primitives", () => {
		expect(navigateValue("hello", ["a"])).toEqual({ value: undefined, found: false });
	});
	it("handles empty segments", () => {
		expect(navigateValue({ a: 1 }, [])).toEqual({ value: { a: 1 }, found: true });
	});
	it("navigates arrays by index-like keys", () => {
		expect(navigateValue({ items: [10, 20, 30] }, ["items", "1"])).toEqual({ value: 20, found: true });
	});
});

describe("validateZodPath", () => {
	const schema = z.object({
		name: z.string(),
		nested: z.object({
			count: z.number(),
			deep: z.object({ flag: z.boolean() }),
		}),
		optional: z.string().optional(),
	});

	it("validates existing top-level field", () => {
		expect(validateZodPath(schema, ["name"])).not.toBeNull();
	});
	it("validates nested field", () => {
		expect(validateZodPath(schema, ["nested", "count"])).not.toBeNull();
	});
	it("validates deeply nested field", () => {
		expect(validateZodPath(schema, ["nested", "deep", "flag"])).not.toBeNull();
	});
	it("validates optional field", () => {
		expect(validateZodPath(schema, ["optional"])).not.toBeNull();
	});
	it("returns null for missing field", () => {
		expect(validateZodPath(schema, ["doesNotExist"])).toBeNull();
	});
	it("returns null for invalid nested path", () => {
		expect(validateZodPath(schema, ["nested", "missing"])).toBeNull();
	});
	it("returns null for path into non-object", () => {
		expect(validateZodPath(schema, ["name", "sub"])).toBeNull();
	});
});
