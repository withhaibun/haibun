import { describe, it, expect } from "vitest";
import { EventFormatter, HaibunEvent, shownLogLevel, type THaibunEvent, type THaibunLogLevel } from "./protocol.js";
import { BaseOptionsSchema } from "../lib/world.js";

describe("Haibun Event Schemas", () => {
	it("validates a correct LifecycleEvent", () => {
		const raw = {
			id: "1.2.3",
			timestamp: 1234567890,
			kind: "lifecycle",
			type: "step",
			stage: "start",
			in: "Given I am testing",
			status: "running",
		};
		const parsed = HaibunEvent.parse(raw);
		expect(parsed).toEqual(expect.objectContaining(raw));
		expect(parsed.kind).toBe("lifecycle");
	});

	it("validates a correct LogEvent with attributes", () => {
		const raw = {
			id: "1.2.3",
			timestamp: 1234567890,
			kind: "log",
			level: "info",
			message: "Processing started",
			attributes: { variable: "foo", value: 123 },
		};
		const parsed = HaibunEvent.parse(raw);
		expect(parsed).toEqual(expect.objectContaining(raw));
		if (parsed.kind === "log") {
			expect(parsed.attributes).toEqual({ variable: "foo", value: 123 });
		} else {
			throw new Error("Expected log event");
		}
	});

	it("validates a Time-Lined ArtifactEvent", () => {
		const raw = {
			id: "1.2.3",
			timestamp: 1234567890,
			kind: "artifact",
			artifactType: "video",
			mimetype: "video/mp4",
			path: "/tmp/video.mp4",
			isTimeLined: true,
			duration: 5000,
		};
		const parsed = HaibunEvent.parse(raw);
		expect(parsed).toEqual(expect.objectContaining(raw));
	});

	it("fails on invalid discriminator", () => {
		const raw = {
			id: "1",
			timestamp: 1,
			kind: "unknown_kind", // Invalid
		};
		expect(() => HaibunEvent.parse(raw)).toThrow();
	});

	it("fails on missing required fields", () => {
		const raw = {
			id: "1",
			// timestamp missing
			kind: "log",
			level: "info",
			message: "foo",
		};
		expect(() => HaibunEvent.parse(raw)).toThrow();
	});
});

describe("the level a monitor shows events from", () => {
	const logged = (level: THaibunLogLevel): THaibunEvent => HaibunEvent.parse({ id: `log-${level}`, timestamp: 1, kind: "log", level, message: level });

	it("is the option actuality states, or info where it isn't set, and shows each event at or above it", () => {
		expect(shownLogLevel({})).toBe("info");
		expect(EventFormatter.shouldDisplay(logged("warn"), shownLogLevel({ LOG_LEVEL: "info" }))).toBe(true);
		expect(EventFormatter.shouldDisplay(logged("debug"), shownLogLevel({ LOG_LEVEL: "info" }))).toBe(false);
	});

	it("shows no events at none, and refuses a level it doesn't know", () => {
		expect(EventFormatter.shouldDisplay(logged("error"), shownLogLevel({ LOG_LEVEL: "none" }))).toBe(false);
		expect(BaseOptionsSchema.shape.LOG_LEVEL.safeParse("inof").success, "actuality's options refuse it").toBe(false);
	});
});
