/** An artifact's line: its kind and where it is, from its record or the artifact event the record copies. */
import { describe, expect, it } from "vitest";
import { artifactOf } from "./run-artifact.js";

describe("an artifact's line", () => {
	it("states the kind, the served path, and the path beside the feature", () => {
		expect(artifactOf({ artifactType: "image", path: "featn-1/shot.png", featureRelativePath: "shot.png", level: "info" })).toEqual({
			kind: "image",
			path: "featn-1/shot.png",
			besideFeature: "shot.png",
		});
		expect(artifactOf({ kind: "artifact", artifactType: "json", json: {} })).toEqual({ kind: "json" });
	});

	it("refuses an object that doesn't state an artifact's kind", () => {
		expect(() => artifactOf({ path: "x" })).toThrow();
	});
});
