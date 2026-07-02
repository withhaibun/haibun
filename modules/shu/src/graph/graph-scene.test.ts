import { describe, it, expect } from "vitest";
import { assertNodeMark, assertLayoutRole, MARK_KINDS, type NodeMark } from "./graph-scene.js";

const mark = (over: Partial<NodeMark> = {}): NodeMark => ({ id: "n", type: "T", kind: "chip", label: "x", color: "#abc", role: { kind: "free" }, ...over });

describe("graph-scene vocabulary (backend-neutral, fail-fast)", () => {
	it("accepts a valid chip and a valid box, returning the mark", () => {
		expect(assertNodeMark(mark())).toMatchObject({ kind: "chip" });
		expect(assertNodeMark(mark({ kind: "box", zExtent: 0, role: { kind: "time", start: 1, end: 2 } }))).toMatchObject({ kind: "box" });
	});

	it("rejects an unknown mark kind", () => {
		expect(() => assertNodeMark(mark({ kind: "blob" as NodeMark["kind"] }))).toThrow(/unknown kind/);
	});

	it("requires a colour", () => {
		expect(() => assertNodeMark(mark({ color: "" }))).toThrow(/missing color/);
	});

	it("requires box marks to carry a finite, non-negative zExtent", () => {
		expect(() => assertNodeMark(mark({ kind: "box" }))).toThrow(/box requires/); // no zExtent
		expect(() => assertNodeMark(mark({ kind: "box", zExtent: -1, role: { kind: "time", start: 0, end: 1 } }))).toThrow(/box requires/);
	});

	it("requires image marks to carry a src", () => {
		expect(() => assertNodeMark(mark({ kind: "image" }))).toThrow(/image requires/);
	});

	it("validates each layout role, including xyz", () => {
		expect(assertLayoutRole({ kind: "free" }, "n")).toEqual({ kind: "free" });
		expect(assertLayoutRole({ kind: "xyz", x: 1, y: 2, z: 3 }, "n")).toMatchObject({ kind: "xyz" });
		expect(assertLayoutRole({ kind: "geo", lat: 51, lon: 0 }, "n")).toMatchObject({ kind: "geo" });
		expect(() => assertLayoutRole({ kind: "time", start: 2, end: 1 }, "n")).toThrow(/start <= end/); // reversed span
		expect(() => assertLayoutRole({ kind: "geo", lat: Number.NaN, lon: 0 }, "n")).toThrow(/finite lat\/lon/);
		expect(() => assertLayoutRole({ kind: "xyz", x: 0, y: 0, z: Number.POSITIVE_INFINITY }, "n")).toThrow(/finite x\/y\/z/);
	});

	it("exposes the closed mark-kind set", () => {
		expect([...MARK_KINDS]).toEqual(["chip", "square", "lozenge", "box", "image", "mesh", "marker"]);
	});
});
