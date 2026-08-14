/**
 * Valid time through the fisheye's own data path: extractTimes is fed snapshot-shaped quads (one property quad per
 * field, exactly what getClusteredQuads delivers) and its output is what toGraphData maps to depth. These assert the
 * user-visible rule — an object places by its OWN time (an email's received time, a file's date) under the valid
 * basis, by generatedAtTime under the indexed basis, and by generatedAtTime as the fallback when a type declares
 * nothing else — and that the depth ordering the renderer derives from those times actually flips between the bases.
 */
import { describe, expect, it } from "vitest";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { timeZScale, timeZ } from "../time-axis.js";
import { DataPipeline, type DataPipelineDeps } from "./polymorphic-data-pipeline.js";

const GENERATED = LinkRelations.GENERATED_AT_TIME.rel;
const NOW = Date.parse("2026-07-06T00:00:00.000Z");
const YEAR_AGO = "2025-07-06T00:00:00.000Z";
const LAST_WEEK = "2026-06-29T00:00:00.000Z";
const TODAY = "2026-07-05T23:00:00.000Z";

/** The catalog rule as the fisheye wires it (rels-cache getValidTimeField): the declared defaultSort, else generatedAtTime. */
const validTimeFieldFor = (type: string): string => ({ Email: "dateReceived", File: "dateModified" })[type] ?? GENERATED;

const quad = (subject: string, namedGraph: string, predicate: string, object: string): TQuad => ({ subject, namedGraph, predicate, object, timestamp: 0 });

/** Snapshot-shaped quads: an old email indexed today, a file modified last week indexed today, a comment with only its record time. */
const snapshotQuads = (): TQuad[] => [
	quad("e1", "Email", "subject", "an old email, indexed today"),
	quad("e1", "Email", "dateReceived", YEAR_AGO),
	quad("e1", "Email", GENERATED, TODAY),
	quad("f1", "File", "dateModified", LAST_WEEK),
	quad("f1", "File", GENERATED, TODAY),
	quad("c1", "Comment", GENERATED, TODAY),
];

const pipelineWith = (basis: "valid" | "indexed", quads: TQuad[] = snapshotQuads()): DataPipeline =>
	new DataPipeline({ quads: () => quads, zBasis: () => basis, validTimeFieldFor } as unknown as DataPipelineDeps);

describe("fisheye valid-time placement from snapshot quads", () => {
	it("valid basis: each subject's time is its type's declared field (carried as the hover's unit label), with generatedAtTime only as the fallback", () => {
		const { times } = pipelineWith("valid").extractTimes();
		expect(times.get("e1")).toEqual({ ms: Date.parse(YEAR_AGO), field: "dateReceived" });
		expect(times.get("f1")).toEqual({ ms: Date.parse(LAST_WEEK), field: "dateModified" });
		expect(times.get("c1")).toEqual({ ms: Date.parse(TODAY), field: GENERATED });
	});

	it("indexed basis: every subject keys to generatedAtTime", () => {
		const { times } = pipelineWith("indexed").extractTimes();
		expect(times.get("e1")).toEqual({ ms: Date.parse(TODAY), field: GENERATED });
		expect(times.get("f1")).toEqual({ ms: Date.parse(TODAY), field: GENERATED });
		expect(times.get("c1")).toEqual({ ms: Date.parse(TODAY), field: GENERATED });
	});

	it("says when EVERY subject was written down, including one whose valid field is generatedAtTime itself", () => {
		// The guide reads in creation order from this map. A comment's one time quad answers both questions — its valid
		// time and its written-down time — and dropping it from `indexed` left the reading with no order but the names.
		const { indexed } = pipelineWith("valid").extractTimes();
		expect(indexed.get("c1"), "the comment is in the creation order").toEqual({ ms: Date.parse(TODAY), field: GENERATED });
		expect(indexed.get("e1"), "alongside the types with a valid field of their own").toEqual({ ms: Date.parse(TODAY), field: GENERATED });
		expect(indexed.get("f1")).toEqual({ ms: Date.parse(TODAY), field: GENERATED });
	});

	it("renders the difference: under the valid basis the year-old email sits deepest, under the indexed basis everything indexed today sits together at the front", () => {
		const depthOf = (basis: "valid" | "indexed"): Record<string, number> => {
			const { times } = pipelineWith(basis).extractTimes();
			const scale = timeZScale(
				[...times.values()].map((t) => t.ms),
				NOW,
				320,
			);
			return Object.fromEntries([...times].map(([subject, t]) => [subject, timeZ(t.ms, NOW, scale)]));
		};
		const valid = depthOf("valid");
		expect(valid.e1).toBeGreaterThan(valid.f1);
		expect(valid.f1).toBeGreaterThan(valid.c1);
		const indexed = depthOf("indexed");
		expect(indexed.e1).toBe(indexed.c1);
		expect(indexed.f1).toBe(indexed.c1);
	});

	it("a subject missing its declared field on the wire places by its indexed time rather than vanishing from the axis", () => {
		const { times } = pipelineWith("valid", [quad("e2", "Email", "subject", "no dateReceived arrived"), quad("e2", "Email", GENERATED, TODAY)]).extractTimes();
		expect(times.get("e2")).toEqual({ ms: Date.parse(TODAY), field: GENERATED });
	});
});

/** The deps toGraphData reads, with one node and no layout of its own; each case states the pins under test. */
const placementDeps = (over: Partial<DataPipelineDeps>): DataPipelineDeps =>
	({
		viewType: () => "force",
		flatten: () => false,
		grouped: () => false,
		groupBy: () => "type",
		quads: () => [],
		visibleQuads: () => [],
		hiddenGraphs: () => [],
		visibleModel: () => ({ nodes: [{ id: "n1", type: "Comment" }], edges: [] }) as unknown as ReturnType<DataPipelineDeps["visibleModel"]>,
		lastModelHash: () => 1,
		timeCursor: () => null,
		zBasis: () => "valid",
		validTimeFieldFor,
		groupAnchors: () => new Map(),
		groupSizes: () => new Map(),
		setGanttTargets: () => undefined,
		setGanttScale: () => undefined,
		setGanttAdornment: () => undefined,
		setGanttShapeSig: () => undefined,
		laneZ: () => undefined,
		lanePinXY: () => undefined,
		userPinXY: () => undefined,
		startNewcomerPop: () => undefined,
		...over,
	}) as DataPipelineDeps;

describe("where a node the user dropped is placed", () => {
	it("keeps the dropped position, so a drag is accepted rather than undone by the next repaint", () => {
		const pipeline = new DataPipeline(placementDeps({ userPinXY: () => ({ x: 40, y: -25 }) }));
		const { nodes } = pipeline.toGraphData();
		expect({ x: nodes[0].x, y: nodes[0].y, fx: nodes[0].fx }).toEqual({ x: 40, y: -25, fx: 40 });
	});

	it("keeps it in a view that has its own layout too: a placement by hand outranks the lane the view would give it", () => {
		const pipeline = new DataPipeline(placementDeps({ viewType: () => "td", lanePinXY: () => ({ x: 300, y: 300 }), userPinXY: () => ({ x: 40, y: -25 }) }));
		const { nodes } = pipeline.toGraphData();
		expect({ x: nodes[0].x, y: nodes[0].y }).toEqual({ x: 40, y: -25 });
	});

	it("leaves every other node to the view's own layout", () => {
		const pipeline = new DataPipeline(placementDeps({ viewType: () => "td", lanePinXY: () => ({ x: 300, y: 300 }) }));
		const { nodes } = pipeline.toGraphData();
		expect({ x: nodes[0].x, y: nodes[0].y }).toEqual({ x: 300, y: 300 });
	});
});
