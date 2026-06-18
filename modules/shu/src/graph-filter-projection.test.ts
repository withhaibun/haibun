import { describe, expect, it } from "vitest";
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { projectFilterClusters, effectiveHiddenTypes } from "./graph-filter-projection.js";

function quad(namedGraph: string, subject: string, timestamp = 1): TQuad {
	return { namedGraph, subject, predicate: "p", object: "o", timestamp };
}

function cluster(type: string, totalCount: number, sampledCount = totalCount, omittedCount = 0): TCluster {
	return { type, totalCount, sampledCount, omittedCount, sampledSubjects: [], displayLabels: {} };
}

describe("projectFilterClusters", () => {
	it("returns the snapshot clusters unchanged when no time cursor is active", () => {
		const result = projectFilterClusters({
			knownClusters: new Map([
				["Kihan", cluster("Kihan", 7, 5, 2)],
				["SeqPath", cluster("SeqPath", 22)],
			]),
			allQuads: [quad("Kihan", "a"), quad("SeqPath", "0.1")],
			visibleQuads: [],
			timeCursor: null,
		});
		expect(result.map((c) => c.type).sort()).toEqual(["Kihan", "SeqPath"]);
		const kihan = result.find((c) => c.type === "Kihan");
		expect(kihan?.totalCount).toBe(7);
		expect(kihan?.sampledCount).toBe(5);
		expect(kihan?.omittedCount).toBe(2);
	});

	it("synthesises zero-count clusters for namedGraphs that appear only in live quads", () => {
		const result = projectFilterClusters({
			knownClusters: new Map([["Kihan", cluster("Kihan", 1)]]),
			allQuads: [quad("Kihan", "a"), quad("Person", "x")],
			visibleQuads: [],
			timeCursor: null,
		});
		const person = result.find((c) => c.type === "Person");
		expect(person).toBeDefined();
		expect(person?.totalCount).toBe(0);
	});

	it("derives counts from visibleQuads when a time cursor is active", () => {
		const result = projectFilterClusters({
			knownClusters: new Map([["Kihan", cluster("Kihan", 7)]]),
			allQuads: [quad("Kihan", "a"), quad("Kihan", "b"), quad("Kihan", "c")],
			visibleQuads: [quad("Kihan", "a"), quad("Kihan", "b")],
			timeCursor: 100,
		});
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe("Kihan");
		expect(result[0].totalCount).toBe(2);
		expect(result[0].sampledCount).toBe(2);
		expect(result[0].omittedCount).toBe(0);
	});

	it("drops types that have no visible subjects at the cursor", () => {
		const result = projectFilterClusters({
			knownClusters: new Map([
				["Kihan", cluster("Kihan", 7)],
				["Person", cluster("Person", 3)],
			]),
			allQuads: [quad("Kihan", "a"), quad("Person", "x")],
			visibleQuads: [quad("Kihan", "a")],
			timeCursor: 100,
		});
		expect(result.map((c) => c.type)).toEqual(["Kihan"]);
	});

	it("counts unique subjects, not quad rows", () => {
		const result = projectFilterClusters({
			knownClusters: new Map(),
			allQuads: [],
			visibleQuads: [quad("Kihan", "a"), quad("Kihan", "a"), quad("Kihan", "b")],
			timeCursor: 100,
		});
		expect(result[0].totalCount).toBe(2);
	});

});

describe("effectiveHiddenTypes (instrumentation default + user overrides)", () => {
	// SeqPath/facts/observation/* = the engine's own instrumentation (default-hidden); Person = domain (default-visible).
	const types = ["Person", "SeqPath", "facts"];

	it("hides instrumentation by default with NO user overrides, and the default is not a stored choice", () => {
		expect(effectiveHiddenTypes(types, {}).sort()).toEqual(["SeqPath", "facts"]);
	});

	it("an explicit show override reveals a default-hidden instrumentation type", () => {
		expect(effectiveHiddenTypes(types, { SeqPath: true })).toEqual(["facts"]);
	});

	it("an explicit hide override hides a default-visible domain type", () => {
		expect(effectiveHiddenTypes(types, { Person: false }).sort()).toEqual(["Person", "SeqPath", "facts"]);
	});

	it("classifies a streamed observation/* type as instrumentation even with no cluster record", () => {
		expect(effectiveHiddenTypes([...types, "observation/http-request"], { SeqPath: true }).sort()).toEqual(["facts", "observation/http-request"]);
	});

	it("treats a non-instrumentation (domain) type as visible", () => {
		expect(effectiveHiddenTypes(["Person"], {})).toEqual([]);
	});

	it("honours an explicit hide of a type not yet present in the set", () => {
		expect(effectiveHiddenTypes(["Person"], { Email: false })).toEqual(["Email"]);
	});
});
