import { describe, it, expect } from "vitest";
import { parseDotPath, navigateValue, validateZodPath } from "./dot-path.js";
import { z } from "zod";

describe("parseDotPath", () => {
	it.each([
		["a simple term has no segments", "foo", { baseName: "foo", pathSegments: [] }],
		["the split is at the first dot", "result.total", { baseName: "result", pathSegments: ["total"] }],
		["every later dot is a further segment", "result.vertex.subject", { baseName: "result", pathSegments: ["vertex", "subject"] }],
		["an empty term is an empty base", "", { baseName: "", pathSegments: [] }],
	])("%s", (_, term, expected) => {
		expect(parseDotPath(term)).toEqual(expected);
	});
});

describe("navigateValue", () => {
	it.each([
		["reads a nested key", { a: { b: 42 } }, ["a", "b"], { value: 42, found: true }],
		["an index-like key reads an array element", { items: [10, 20, 30] }, ["items", "1"], { value: 20, found: true }],
		["no segments is the value itself", { a: 1 }, [], { value: { a: 1 }, found: true }],
		["a missing key is not found", { a: 1 }, ["b"], { value: undefined, found: false }],
		["null holds nothing to read", null, ["a"], { value: undefined, found: false }],
		["neither does a primitive", "hello", ["a"], { value: undefined, found: false }],
	])("%s", (_, value, segments, expected) => {
		expect(navigateValue(value, segments as string[])).toEqual(expected);
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

	// A path the schema declares resolves to its field; anything else is null, including a path that walks INTO a
	// declared leaf, since a string has no fields to reach.
	it.each([
		["a top-level field", ["name"], true],
		["a nested field", ["nested", "count"], true],
		["a deeply nested field", ["nested", "deep", "flag"], true],
		["an optional field", ["optional"], true],
		["a field the schema does not declare", ["doesNotExist"], false],
		["a missing field under a declared object", ["nested", "missing"], false],
		["a path into a leaf", ["name", "sub"], false],
	])("%s", (_, path, resolves) => {
		const found = validateZodPath(schema, path as string[]);
		expect(found === null).toBe(!resolves);
	});
});
