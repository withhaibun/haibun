import { describe, it, expect, beforeEach } from "vitest";
import { EventLogger } from "./event-logger.js";
import { OBSCURED_VALUE } from "../domains/secrets.js";
import type { TEventSink, TSecrets } from "../ports.js";
import { serializedEvent } from "../derivations/serialized-event.js";
import { BlipEvent, ImageArtifact, LogEvent, type THaibunEvent } from "../../domains/protocol.js";
import { runAuthorizedWith, runInStep, runReadingAt } from "../../capability-context.js";
import { readAction, writeAction } from "../../actions.js";
import { Access } from "../../resources.js";
import { itemAt } from "../../util/item-at.js";

/** The secrets a test hub obscures: the secret values actuality holds. */
const secretsOf = (values: readonly string[]): TSecrets => ({ values: () => values });
/** A sink that holds each text the hub writes. */
const heldSink = (): TEventSink & { written: string[] } => {
	const written: string[] = [];
	return { written, write: (serialized) => written.push(serialized) };
};
/** A hub that doesn't hold a secret and writes to a sink a test doesn't read. */
const plainLogger = () => new EventLogger(secretsOf([]), heldSink(), false);

describe("EventLogger", () => {
	let logger: EventLogger;

	beforeEach(() => {
		logger = new EventLogger(secretsOf([]), heldSink(), false);
		logger.suppressConsole = true;
	});

	describe("subscribe/unsubscribe", () => {
		it("should stop receiving events after unsubscribe", () => {
			const emitted: unknown[] = [];
			const callback = (event: unknown) => emitted.push(event);
			logger.subscribe(callback);
			logger.info("before");
			expect(emitted.length).toBe(1);

			logger.unsubscribe(callback);
			logger.info("after");
			expect(emitted.length).toBe(1);
		});

		it("should remove every count of a repeated subscription on one unsubscribe, so per-kind counts stay correct", () => {
			const callback = () => undefined;
			logger.subscribe(callback);
			logger.subscribe(callback);
			expect(logger.hasSubscribers("log")).toBe(true);
			logger.unsubscribe(callback);
			expect(logger.hasSubscribers("log")).toBe(false);
		});

		it("should support multiple subscribers independently", () => {
			const emittedA: unknown[] = [];
			const emittedB: unknown[] = [];
			const callbackA = (event: unknown) => emittedA.push(event);
			const callbackB = (event: unknown) => emittedB.push(event);

			logger.subscribe(callbackA);
			logger.subscribe(callbackB);
			logger.info("both");
			expect(emittedA.length).toBe(1);
			expect(emittedB.length).toBe(1);

			logger.unsubscribe(callbackA);
			logger.info("only B");
			expect(emittedA.length).toBe(1);
			expect(emittedB.length).toBe(2);
		});
	});

	describe("kinds delivery", () => {
		const blip = (name = "haibun.test.blip") => BlipEvent.parse({ id: "0.1.blip", timestamp: Date.now(), kind: "blip", level: "trace", emitter: "test", name });

		it("delivers narration to a subscriber without options, and never a blip", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event));
			logger.subscribe(() => undefined, { kinds: ["blip"] }); // so emit doesn't return early for the blip
			logger.emit(blip());
			logger.info("narration");
			expect(emitted.map((e) => (e as { kind: string }).kind)).toEqual(["log"]);
		});

		it("delivers only the listed kinds to a subscriber that lists kinds, and only such a subscriber receives blips", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event), { kinds: ["blip"] });
			logger.emit(blip());
			logger.info("narration");
			expect(emitted.map((e) => (e as { kind: string }).kind)).toEqual(["blip"]);
		});

		it("filters blips by declared name, exact or by dotted namespace", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event), { kinds: ["blip"], names: ["haibun.http", "haibun.shu.view.scroll_adjust"] });
			logger.emit(blip("haibun.http.request")); // namespace match
			logger.emit(blip("haibun.shu.view.scroll_adjust")); // exact match
			logger.emit(blip("haibun.httpx.request")); // a name that starts with the text haibun.http isn't in the haibun.http namespace
			logger.emit(blip("haibun.shu.view.scroll_adjust_other"));
			expect(emitted.map((e) => (e as { name: string }).name)).toEqual(["haibun.http.request", "haibun.shu.view.scroll_adjust"]);
		});

		it("evaluates hasSubscribers per name, so the recording site skips a blip without a matching subscriber", () => {
			logger.subscribe(() => undefined, { kinds: ["blip"], names: ["haibun.http"] });
			expect(logger.hasSubscribers("blip", "haibun.http.request")).toBe(true);
			expect(logger.hasSubscribers("blip", "haibun.shu.view.scroll_adjust")).toBe(false);
			logger.subscribe(() => undefined, { kinds: ["blip"] }); // a blip subscriber without names receives a blip of every name
			expect(logger.hasSubscribers("blip", "haibun.shu.view.scroll_adjust")).toBe(true);
		});

		it("counts subscribers per kind, so a recording site can skip recording with one check", () => {
			expect(logger.hasSubscribers("blip")).toBe(false);
			logger.subscribe(() => undefined); // a subscriber without options doesn't receive blips
			expect(logger.hasSubscribers("blip")).toBe(false);
			expect(logger.hasSubscribers("log")).toBe(true);
			const cb = () => undefined;
			logger.subscribe(cb, { kinds: ["blip"] });
			expect(logger.hasSubscribers("blip")).toBe(true);
			logger.unsubscribe(cb);
			expect(logger.hasSubscribers("blip")).toBe(false);
		});

		it("never writes a blip to the sink", () => {
			const sink = heldSink();
			const hub = new EventLogger(secretsOf([]), sink, false);
			hub.subscribe(() => undefined, { kinds: ["blip"] });
			hub.emit(blip());
			expect(sink.written).toHaveLength(0);
			hub.info("narration");
			expect(sink.written).toHaveLength(1);
		});
	});
	describe("the level of a log statement", () => {
		/** A step that reports at trace, as a call made into a running instance does. */
		const DURING_A_TRACE_STEP = { seqPath: "0.1", reportsAt: "trace" as const };
		const said = (): Array<Record<string, unknown>> => {
			const heard: Array<Record<string, unknown>> = [];
			logger.subscribe((e) => heard.push(e as unknown as Record<string, unknown>), { kinds: ["log"] });
			return heard;
		};

		it("reports at its own level outside a step", () => {
			const heard = said();
			logger.info("actuality reports something");
			expect(itemAt(heard, 0).level).toBe("info");
		});

		it("reports at most at the level of the step in flight, so a call into a running instance stays out of actuality's history", () => {
			const heard = said();
			runInStep(DURING_A_TRACE_STEP, () => logger.info("what the caller's own step logged"));
			expect(itemAt(heard, 0).level, "logged during a step that reports at trace").toBe("trace");
		});

		it("keeps the level of a statement quieter than its step", () => {
			const heard = said();
			runInStep(DURING_A_TRACE_STEP, () => logger.debug("quieter than the step"));
			expect(itemAt(heard, 0).level).toBe("debug");
		});

		it("reports a warning and an error at their own levels during a quieter step", () => {
			const heard = said();
			runInStep(DURING_A_TRACE_STEP, () => {
				logger.warn("something is wrong");
				logger.error("something failed");
			});
			expect(heard.map((e) => e.level)).toEqual(["warn", "error"]);
		});
	});
});

describe("the level of an artifact", () => {
	it("keeps the level its schema sets, whether a quieter step is in flight or not", () => {
		const emitted: Array<{ level?: string }> = [];
		const logger = plainLogger();
		logger.suppressConsole = true;
		logger.subscribe((event) => emitted.push(event as { level?: string }), { kinds: ["artifact"] });
		// A producer parses an artifact with its schema, which sets the level to info.
		const screenshot = (path: string, id: string) => ImageArtifact.parse({ kind: "artifact", artifactType: "image", path, id, timestamp: 1 });
		runInStep({ seqPath: "0.1.2", reportsAt: "trace" }, () => logger.artifact(screenshot("a.png", "x")));
		logger.artifact(screenshot("b.png", "y"));
		expect(
			emitted.map((e) => (e as { level?: string }).level),
			"an artifact isn't capped at its step's level",
		).toEqual(["info", "info"]);
	});
});

describe("the level an event states", () => {
	const said = (message: string) => LogEvent.parse({ id: message, timestamp: 0, kind: "log", level: "info", message });

	it("is a level stated at emit, or else the read level of the call that emitted it: public for a call bounded to public reads, private for actuality's own event", async () => {
		const logger = plainLogger();
		logger.suppressConsole = true;
		const levels: Record<string, unknown> = {};
		logger.subscribe((event: THaibunEvent) => void (levels[event.id] = event.accessLevel));
		await runReadingAt(Access.public, () => Promise.resolve(logger.emit(said("bounded"))));
		logger.emit(said("actuality's own"));
		logger.emit({ ...said("stated"), accessLevel: Access.opened });
		expect(levels).toEqual({ bounded: Access.public, "actuality's own": Access.private, stated: Access.opened });
	});

	it("is rejected where it is more public than the call's read level and the call doesn't hold that level's write action", async () => {
		const logger = plainLogger();
		logger.suppressConsole = true;
		const reader = [readAction(Access.private)];
		const announce = () => runAuthorizedWith(reader, () => runReadingAt(Access.private, async () => logger.emit({ ...said("published"), accessLevel: Access.public })));
		await expect(announce()).rejects.toThrow(writeAction(Access.public));
	});
});

describe("an event's secrets", () => {
	it("reach every subscriber and the sink obscured in a log's message and attributes (ZH13)", () => {
		const sink = heldSink();
		const hub = new EventLogger(secretsOf(["s3cr3t-pass"]), sink, false);
		const emitted: THaibunEvent[] = [];
		hub.subscribe((event) => emitted.push(event));
		hub.subscribe((event) => emitted.push(event));
		hub.info("signing in with s3cr3t-pass as the DB_PASSWORD", { form: { field: "s3cr3t-pass" }, tries: ["s3cr3t-pass"] });
		expect(emitted).toHaveLength(2);
		for (const event of emitted) expect(JSON.stringify(event)).not.toContain("s3cr3t-pass");
		expect(itemAt(emitted, 0)).toMatchObject({
			message: `signing in with ${OBSCURED_VALUE} as the DB_PASSWORD`,
			attributes: { form: { field: OBSCURED_VALUE }, tries: [OBSCURED_VALUE] },
		});
		expect(sink.written.join("")).not.toContain("s3cr3t-pass");
	});
});

describe("an event's serialization", () => {
	it("serializes an event once for the sink and every transport that reads it, and doesn't name an emitter the event doesn't state (PF28)", () => {
		const sink = heldSink();
		const hub = new EventLogger(secretsOf([]), sink, false);
		let serializations = 0;
		const counted = { toJSON: () => (serializations++, "counted") };
		let received: THaibunEvent | undefined;
		hub.subscribe((event) => {
			received = event;
		});
		hub.info("an event whose attribute counts its serializations", { counted });
		if (received === undefined) throw new Error("the subscriber didn't receive the event");
		const forTransports = [serializedEvent(received), serializedEvent(received)];
		expect(serializations, "the sink and two transports read one serialization").toBe(1);
		expect(forTransports).toEqual([itemAt(sink.written, 0), itemAt(sink.written, 0)]);
		expect(received.emitter, "the hub doesn't walk the stack to name an emitter").toBeUndefined();
	});
});
