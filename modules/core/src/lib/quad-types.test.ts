import { describe, it, expect } from "vitest";
import { emitQuadObservation, extractQuadsFromEvents, eventsAffectLabel, OBSERVATION_VALUE_MAX } from "./quad-types.js";

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
		expect(eventsAffectLabel([quadEvent("VerifiableCredential")], "VerifiableCredential")).toBe(true);
	});

	it("is false when no quad is in the label's named graph", () => {
		expect(eventsAffectLabel([quadEvent("Email")], "VerifiableCredential")).toBe(false);
	});

	it("is false when the batch carries no quads (e.g. a plain log event)", () => {
		expect(eventsAffectLabel([{ id: "log-1", timestamp: 1, kind: "log", level: "info" }], "VerifiableCredential")).toBe(false);
	});

	it("with no label, any quad is relevant (unscoped view); an empty batch is not", () => {
		expect(eventsAffectLabel([quadEvent("Email")])).toBe(true);
		expect(eventsAffectLabel([])).toBe(false);
	});
});

describe("emitQuadObservation carries previews, never payloads", () => {
	it("bounds a long string value to OBSERVATION_VALUE_MAX and leaves short values intact", () => {
		const emitted: Record<string, unknown>[] = [];
		const logger = { emit: (e: Record<string, unknown>) => emitted.push(e) };
		const body = "x".repeat(OBSERVATION_VALUE_MAX * 200);
		emitQuadObservation(logger, "q1", { subject: "e1", predicate: "content", object: body, namedGraph: "Body", timestamp: 1 });
		emitQuadObservation(logger, "q2", { subject: "e1", predicate: "subject", object: "short", namedGraph: "Email", timestamp: 2 });
		const objects = emitted.map((e) => (e.json as { quadObservation: { object: unknown } }).quadObservation.object);
		expect(String(objects[0]).length).toBe(OBSERVATION_VALUE_MAX + 1);
		expect(String(objects[0]).endsWith("\u2026")).toBe(true);
		expect(objects[1]).toBe("short");
	});
});
