import { describe, it, expect } from "vitest";
import { parseDotPath, navigateValue, validateZodPath } from "./dot-path.js";
import { z } from "zod";

describe("parseDotPath", () => {
	it.each([
		["a simple term doesn't have segments", "foo", { baseName: "foo", pathSegments: [] }],
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
		["an empty path is the value itself", { a: 1 }, [], { value: { a: 1 }, found: true }],
		["a missing key is not found, naming the fields the value has", { a: 1 }, ["b"], { value: undefined, found: false, miss: { at: [], missing: "b", has: ["a"] } }],
		["a nested miss names the path it read", { a: { c: 1 } }, ["a", "b"], { value: undefined, found: false, miss: { at: ["a"], missing: "b", has: ["c"] } }],
		["null doesn't hold a value to read", null, ["a"], { value: undefined, found: false, miss: { at: [], missing: "a", has: [] } }],
		["a primitive doesn't either", "hello", ["a"], { value: undefined, found: false, miss: { at: [], missing: "a", has: [] } }],
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
	// declared leaf, since a string doesn't have fields to reach.
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
