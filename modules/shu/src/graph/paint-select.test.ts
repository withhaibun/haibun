import { describe, it, expect } from "vitest";
import { availablePaints } from "./paint-select.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

const q = (subject: string, predicate: string, object: unknown): TQuad => ({ subject, predicate, object, namedGraph: "Task", timestamp: 1 }) as TQuad;
const idRel = (p: string): string => p;

describe("availablePaints", () => {
	it("offers the Gantt view-type when a node carries a start-time rel", () => {
		const paints = availablePaints([q("t1", LinkRelations.STARTED_AT_TIME.rel, "2026-01-01"), q("t1", "name", "Design")], idRel);
		expect(paints.map((p) => p.id)).toEqual(["gantt"]);
		expect(paints[0].label).toBe("Gantt");
	});

	it("offers no paint view-types for data with none of their rels", () => {
		expect(availablePaints([q("x", "name", "y")], idRel)).toEqual([]);
	});
});
