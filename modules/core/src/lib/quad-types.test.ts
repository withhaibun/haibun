import { describe, it, expect } from "vitest";
import { emitQuadObservation, extractQuadsFromEvents, eventsAffectLabel, OBSERVATION_VALUE_MAX, type TQuad, matchesQuadPattern } from "./quad-types.js";

const quadEvent = (namedGraph: string) => ({
	id: `q-${namedGraph}`,
	timestamp: 1000,
	kind: "artifact",
	artifactType: "json",
	json: { quadObservation: { subject: "s", predicate: "name", object: "v", namedGraph, timestamp: 1000 } },
});

describe("extractQuadsFromEvents", () => {
	it("extracts quadObservation from artifact events", () => {
		const events = [
			{ id: "log-1", timestamp: 1000, kind: "log", level: "info", source: "test" },
			{
				id: "quad-http-1",
				timestamp: 2000,
				kind: "artifact",
				artifactType: "json",
				source: "haibun",
				json: { quadObservation: { subject: "/api/test", predicate: "name", object: "GET 200 5ms", namedGraph: "observation/http", timestamp: 2000 } },
			},
			{
				id: "quad-http-2",
				timestamp: 3000,
				kind: "artifact",
				artifactType: "json",
				source: "haibun",
				json: { quadObservation: { subject: "/api/other", predicate: "name", object: "POST 201 12ms", namedGraph: "observation/http", timestamp: 3000 } },
			},
			{ id: "artifact-1", timestamp: 4000, kind: "artifact", artifactType: "screenshot", source: "test" },
		];
		const quads = extractQuadsFromEvents(events);
		expect(quads).toHaveLength(2);
		expect(quads[0]).toMatchObject({ subject: "/api/test", predicate: "name", object: "GET 200 5ms", namedGraph: "observation/http" });
		expect(quads[1]).toMatchObject({ subject: "/api/other", predicate: "name", object: "POST 201 12ms", namedGraph: "observation/http" });
	});

	it("returns empty array for events with no quadObservations", () => {
		const events = [
			{ id: "log-1", timestamp: 1000, kind: "log", level: "info", source: "test" },
			{ id: "artifact-1", timestamp: 2000, kind: "artifact", artifactType: "screenshot", source: "test" },
		];
		expect(extractQuadsFromEvents(events)).toEqual([]);
	});

	it("skips malformed quadObservations missing required fields", () => {
		const events = [
			{ id: "bad-1", timestamp: 1000, kind: "artifact", artifactType: "json", json: { quadObservation: { subject: "", predicate: "name", namedGraph: "test" } } },
			{ id: "bad-2", timestamp: 2000, kind: "artifact", artifactType: "json", json: { quadObservation: { subject: "x", predicate: "", namedGraph: "test" } } },
			{ id: "bad-3", timestamp: 3000, kind: "artifact", artifactType: "json", json: { other: "data" } },
		];
		expect(extractQuadsFromEvents(events)).toEqual([]);
	});

	it("uses event timestamp when quad has no timestamp", () => {
		const events = [
			{ id: "q-1", timestamp: 5000, kind: "artifact", artifactType: "json", json: { quadObservation: { subject: "/x", predicate: "name", object: "val", namedGraph: "test" } } },
		];
		const quads = extractQuadsFromEvents(events);
		expect(quads[0].timestamp).toBe(5000);
	});
});

describe("eventsAffectLabel", () => {
	it("is true when a quad matches the label", () => {
		expect(eventsAffectLabel([quadEvent("FieldReport")], "FieldReport")).toBe(true);
	});

	it("is false when no quad is in the label's named graph", () => {
		expect(eventsAffectLabel([quadEvent("Email")], "FieldReport")).toBe(false);
	});

	it("is false when the batch carries no quads (e.g. a plain log event)", () => {
		expect(eventsAffectLabel([{ id: "log-1", timestamp: 1, kind: "log", level: "info" }], "FieldReport")).toBe(false);
	});

	it("with no label, any quad is relevant (unscoped view); an empty batch is not", () => {
		expect(eventsAffectLabel([quadEvent("Email")])).toBe(true);
		expect(eventsAffectLabel([])).toBe(false);
	});
});

describe("emitQuadObservation carries previews, never payloads", () => {
	it("bounds a long string value to OBSERVATION_VALUE_MAX, marks it a preview, and passes short values by reference", () => {
		const emitted: Record<string, unknown>[] = [];
		const logger = { emit: (e: Record<string, unknown>) => emitted.push(e) };
		const body = "x".repeat(OBSERVATION_VALUE_MAX * 200);
		const short: TQuad = { subject: "e1", predicate: "subject", object: "short", namedGraph: "Email", timestamp: 2 };
		emitQuadObservation(logger, "q1", { subject: "e1", predicate: "content", object: body, namedGraph: "Body", timestamp: 1 });
		emitQuadObservation(logger, "q2", short);
		const observations = emitted.map((e) => (e.json as { quadObservation: TQuad }).quadObservation);
		expect(String(observations[0].object).length).toBe(OBSERVATION_VALUE_MAX);
		expect(String(observations[0].object).endsWith("\u2026")).toBe(true);
		expect(observations[0].properties?.preview).toBe(true);
		expect(observations[1]).toBe(short);
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

	it("names only the fields it states, so a pattern of nothing matches everything", () => {
		expect(matchesQuadPattern(quad("one"), {})).toBe(true);
		expect(matchesQuadPattern(quad("one"), { subject: "s", predicate: "q" })).toBe(false);
		expect(matchesQuadPattern(quad("one"), { namedGraph: "H" })).toBe(false);
	});
});
