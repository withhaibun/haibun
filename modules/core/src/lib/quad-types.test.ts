import { describe, it, expect } from "vitest";
import { extractQuadsFromEvents } from "./quad-types.js";

describe("extractQuadsFromEvents", () => {
	it("extracts quadObservation from artifact events", () => {
		const events = [
			{ id: "log-1", timestamp: 1000, kind: "log", level: "info", source: "test" },
			{
				id: "quad-http-1", timestamp: 2000, kind: "artifact", artifactType: "json", source: "haibun",
				json: { quadObservation: { subject: "/api/test", predicate: "name", object: "GET 200 5ms", namedGraph: "observation/http", timestamp: 2000 } },
			},
			{
				id: "quad-http-2", timestamp: 3000, kind: "artifact", artifactType: "json", source: "haibun",
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
