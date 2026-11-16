import { describe, expect, it } from "vitest";
import { evaluateSourceProperty, readSourceProperty, sourcePropertyOf } from "./source-properties.js";
import type { TSourceProperty } from "./resources.js";
import type { TWorld } from "../actuality/domains/world.js";

const world = {} as TWorld;
const text = (maxBytes: number): TSourceProperty => ({
	domain: "text",
	maxBytes,
	read: async () => "ααααα",
	evaluate: async (_subject, operator, expected) =>
		operator === "contains" ? { matches: "ααααα".includes(String(expected)), byteLength: 10 } : operator === "is" ? { matches: false, byteLength: 10 } : undefined,
});

describe("reading a source property", () => {
	it("copies a value within its ceiling", async () => {
		await expect(readSourceProperty(world, "x", text(64))).resolves.toBe("ααααα");
	});

	it("refuses a value over its ceiling, stating both counts", async () => {
		await expect(readSourceProperty(world, "x", text(4))).rejects.toThrow(/holds 10 bytes, over the 4 its property allows/);
	});
});

describe("evaluating a source property in place", () => {
	it("returns a verdict for an operator the property states, with the value's byte length", async () => {
		await expect(evaluateSourceProperty(world, "x", text(4), "contains", "αα", undefined)).resolves.toEqual({ matches: true, byteLength: 10 });
	});

	it("returns undefined for an operator it doesn't state, leaving the comparison to the caller", async () => {
		await expect(evaluateSourceProperty(world, "x", text(64), "isLessThan", "a", undefined)).resolves.toBeUndefined();
	});

	it("returns undefined for a path into a domain whose declarations lack the property", () => {
		expect(sourcePropertyOf({ doc: { properties: { text: text(4) } } }, "doc", "title")).toBeUndefined();
		expect(sourcePropertyOf({ doc: { properties: { text: text(4) } } }, undefined, "text")).toBeUndefined();
	});

	it("finds the property a path into the value takes", () => {
		expect(sourcePropertyOf({ doc: { properties: { text: text(4) } } }, "doc", "text")?.maxBytes).toBe(4);
	});
});
