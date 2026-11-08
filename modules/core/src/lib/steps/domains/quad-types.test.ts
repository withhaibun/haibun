import { describe, it, expect } from "vitest";
import { extractQuadsFromEvents, eventsAffectLabel } from "../derivations/quad-events.js";
import { type TQuad, matchesQuadPattern, OBSERVATION_VALUE_MAX, quadObservation } from "./quad-types.js";
import { itemAt } from "../../domains/item-at.js";

const quad = (subject: string, object: unknown, namedGraph: string, timestamp: number): TQuad => ({ subject, predicate: "name", object, namedGraph, timestamp });
const quadEvent = (namedGraph: string) => quadObservation(`unit-${namedGraph}`, 1000, [quad("s", "v", namedGraph, 1000)]);

describe("extractQuadsFromEvents", () => {
	it("extracts the quads of each unit's observation, in the order of the events and of each unit's changes", () => {
		const events = [
			{ id: "log-1", timestamp: 1000, kind: "log", level: "info", source: "test" },
			quadObservation("unit-1", 2000, [quad("/api/test", "GET 200 5ms", "observation/http", 2000), quad("/api/test", "GET", "observation/http", 2000)]),
			quadObservation("unit-2", 3000, [quad("/api/other", "POST 201 12ms", "observation/http", 3000)]),
			{ id: "artifact-1", timestamp: 4000, kind: "artifact", artifactType: "screenshot", source: "test" },
		];
		expect(extractQuadsFromEvents(events).map(({ subject, object }) => [subject, object])).toEqual([
			["/api/test", "GET 200 5ms"],
			["/api/test", "GET"],
			["/api/other", "POST 201 12ms"],
		]);
	});

	it("returns empty array for events without quadObservations", () => {
		const events = [
			{ id: "log-1", timestamp: 1000, kind: "log", level: "info", source: "test" },
			{ id: "artifact-1", timestamp: 2000, kind: "artifact", artifactType: "screenshot", source: "test" },
		];
		expect(extractQuadsFromEvents(events)).toEqual([]);
	});

	it("skips an observation whose quad lacks a required field", () => {
		const unit = (quads: unknown[]) => ({ id: "bad", timestamp: 1000, kind: "artifact", artifactType: "json", json: { quadObservation: { timestamp: 1000, quads } } });
		const events = [
			unit([{ subject: "", predicate: "name", namedGraph: "test", timestamp: 1000 }]),
			unit([{ subject: "x", predicate: "", namedGraph: "test", timestamp: 1000 }]),
			{ id: "bad-3", timestamp: 3000, kind: "artifact", artifactType: "json", json: { other: "data" } },
		];
		expect(extractQuadsFromEvents(events)).toEqual([]);
	});

	it("doesn't read an observation of a quad that doesn't state when it was written, which a store's write always states", () => {
		const events = [
			{
				id: "q-1",
				timestamp: 5000,
				kind: "artifact",
				artifactType: "json",
				json: { quadObservation: { timestamp: 5000, quads: [{ subject: "/x", predicate: "name", object: "val", namedGraph: "test" }] } },
			},
		];
		expect(extractQuadsFromEvents(events)).toEqual([]);
	});
});

describe("eventsAffectLabel", () => {
	it("is true when a quad matches the label", () => {
		expect(eventsAffectLabel([quadEvent("FieldReport")], "FieldReport")).toBe(true);
	});

	it("is false when the quads aren't in the label's named graph", () => {
		expect(eventsAffectLabel([quadEvent("Letter")], "FieldReport")).toBe(false);
	});

	it("is false when the batch doesn't carry quads (e.g. a plain log event)", () => {
		expect(eventsAffectLabel([{ id: "log-1", timestamp: 1, kind: "log", level: "info" }], "FieldReport")).toBe(false);
	});

	it("without a label, any quad is relevant (unscoped view); an empty batch is not", () => {
		expect(eventsAffectLabel([quadEvent("Letter")])).toBe(true);
		expect(eventsAffectLabel([])).toBe(false);
	});
});

describe("a quad observation carries previews, never payloads", () => {
	it("bounds a long string value to OBSERVATION_VALUE_MAX, marks it a preview, and passes short values by reference", () => {
		const body = "x".repeat(OBSERVATION_VALUE_MAX * 200);
		const short: TQuad = { subject: "e1", predicate: "subject", object: "short", namedGraph: "Letter", timestamp: 2 };
		const [preview, kept] = extractQuadsFromEvents([
			quadObservation("unit-1", 1, [{ subject: "e1", predicate: "content", object: body, namedGraph: "Body", timestamp: 1 }, short]),
		]);
		expect(String(preview?.object).length).toBe(OBSERVATION_VALUE_MAX);
		expect(String(preview?.object).endsWith("\u2026")).toBe(true);
		expect(preview?.properties?.preview).toBe(true);
		expect(itemAt((quadObservation("unit-2", 2, [short]).json.quadObservation as { quads: TQuad[] }).quads, 0)).toBe(short);
		expect(kept).toEqual(short);
	});
});

describe("matching a quad against a pattern", () => {
	const quad = (object: unknown) => ({ subject: "s", predicate: "p", object, namedGraph: "G", timestamp: 1 });

	it("compares an object as a value, so an array or an object read back from any store is the same object", () => {
		expect(matchesQuadPattern(quad(["x", "y"]), { object: ["x", "y"] })).toBe(true);
		expect(matchesQuadPattern(quad({ a: 1 }), { object: { a: 1 } })).toBe(true);
		expect(matchesQuadPattern(quad(true), { object: true })).toBe(true);
		expect(matchesQuadPattern(quad("one"), { object: "two" })).toBe(false);
	});

	it("names only the fields it states, so an empty pattern matches every quad", () => {
		expect(matchesQuadPattern(quad("one"), {})).toBe(true);
		expect(matchesQuadPattern(quad("one"), { subject: "s", predicate: "q" })).toBe(false);
		expect(matchesQuadPattern(quad("one"), { namedGraph: "H" })).toBe(false);
	});
});
