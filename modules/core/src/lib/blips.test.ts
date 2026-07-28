import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { declareBlips, blipDeclarations, recordBlip, resetBlips, BlipRollup } from "./blips.js";
import { EventLogger } from "./EventLogger.js";
import type { THaibunEvent } from "../schema/protocol.js";
import type { TWorld } from "./world.js";

const make = (seqPath?: string) => {
	const eventLogger = new EventLogger();
	const world = { runtime: { currentSeqPath: seqPath }, eventLogger } as unknown as TWorld;
	return { eventLogger, world };
};
const SCROLL = {
	name: "haibun.test.view.scroll_adjust",
	instrument: "span-event" as const,
	description: "A view moved by itself after its scroll settled.",
	unit: "px",
	attributes: z.object({ view: z.string() }),
	dimensions: ["view"] as const,
};

describe("blips: fine-grained occurrences, never retained", () => {
	beforeEach(resetBlips);

	it("costs nothing when nothing is subscribed to the kind — a hot path can record unconditionally", () => {
		declareBlips(SCROLL);
		const { world, eventLogger } = make("0.1.2");
		const narrated: THaibunEvent[] = [];
		// A bare subscriber narrates the run; it is not a blip audience, so recording still returns before any lookup.
		eventLogger.subscribe((e) => narrated.push(e));
		expect(() => recordBlip(world, "haibun.test.never.declared", 1)).not.toThrow();
		expect(narrated).toHaveLength(0);
	});

	it("hands a recording to every blip subscriber, with the step it happened under", () => {
		declareBlips(SCROLL);
		const { world, eventLogger } = make("0.1.2.3");
		const seen: THaibunEvent[] = [];
		eventLogger.subscribe((e) => seen.push(e), { kinds: ["blip"] });
		recordBlip(world, SCROLL.name, 1, { view: "shu-document-column" });
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ kind: "blip", name: SCROLL.name, seqPath: "0.1.2.3", value: 1, attributes: { view: "shu-document-column" } });
	});

	it("never reaches a bare subscriber: blips share the transport, not the audience", () => {
		declareBlips(SCROLL);
		const { world, eventLogger } = make("0.1");
		const narrated: THaibunEvent[] = [];
		const blips: THaibunEvent[] = [];
		eventLogger.subscribe((e) => narrated.push(e));
		eventLogger.subscribe((e) => blips.push(e), { kinds: ["blip"] });
		recordBlip(world, SCROLL.name, 1, { view: "a" });
		eventLogger.info("narration");
		expect(blips.map((e) => e.kind)).toEqual(["blip"]);
		expect(narrated.map((e) => e.kind)).toEqual(["log"]);
	});

	it("delivers only the names a subscriber filtered to, exact or by dotted namespace", () => {
		const HTTP = { name: "haibun.test.http.request", instrument: "span-event" as const, description: "An observed request completed." };
		declareBlips(SCROLL, HTTP);
		const { world, eventLogger } = make("0.1");
		const seen: THaibunEvent[] = [];
		eventLogger.subscribe((e) => seen.push(e), { kinds: ["blip"], names: ["haibun.test.http"] });
		recordBlip(world, SCROLL.name, 1, { view: "a" });
		recordBlip(world, HTTP.name);
		expect(seen.map((e) => (e.kind === "blip" ? e.name : e.kind))).toEqual([HTTP.name]);
	});

	it("returns before any lookup when no filter matches the name, so an unwatched hot path still costs one check", () => {
		const { world, eventLogger } = make();
		eventLogger.subscribe(() => undefined, { kinds: ["blip"], names: ["haibun.test.http"] });
		// Undeclared and mismatched: with no subscriber filter matching, recording never reaches the declaration check.
		expect(() => recordBlip(world, "haibun.test.never.declared", 1)).not.toThrow();
	});

	it("refuses a names filter without the blip kind, rather than silently never delivering", () => {
		const { eventLogger } = make();
		expect(() => eventLogger.subscribe(() => undefined, { names: ["haibun.test.http"] })).toThrow(/kinds/);
	});

	it("refuses a name nobody declared, rather than letting a vocabulary grow at the call site", () => {
		const { world, eventLogger } = make();
		eventLogger.subscribe(() => undefined, { kinds: ["blip"] });
		expect(() => recordBlip(world, "haibun.test.undeclared", 1)).toThrow(/not declared/);
	});

	it("refuses attributes that do not match the declaration, so a stray key never reaches an exporter", () => {
		declareBlips(SCROLL);
		const { world, eventLogger } = make();
		eventLogger.subscribe(() => undefined, { kinds: ["blip"] });
		expect(() => recordBlip(world, SCROLL.name, 1, { viewe: "typo" })).toThrow();
	});

	it("emits only the attributes the declaration names, so a stray key cannot ride along", () => {
		declareBlips(SCROLL);
		const { world, eventLogger } = make();
		const seen: THaibunEvent[] = [];
		eventLogger.subscribe((e) => seen.push(e), { kinds: ["blip"] });
		recordBlip(world, SCROLL.name, 1, { view: "a", stray: "a whole response body" });
		expect(seen[0].kind === "blip" && seen[0].attributes).toEqual({ view: "a" });
	});

	it("refuses a recording that omits attributes the declaration requires", () => {
		declareBlips(SCROLL);
		const { world, eventLogger } = make();
		eventLogger.subscribe(() => undefined, { kinds: ["blip"] });
		expect(() => recordBlip(world, SCROLL.name, 1)).toThrow();
	});

	it("refuses to redeclare one name as two different things", () => {
		declareBlips(SCROLL);
		expect(() => declareBlips({ ...SCROLL, instrument: "counter", unit: "1" })).toThrow(/already declared/);
		expect(() => declareBlips(SCROLL)).not.toThrow(); // the same shape again is the same declaration
	});

	it("refuses a second attribute schema under one name, which would strip or reject the first caller's recordings", () => {
		declareBlips(SCROLL);
		// Everything a reader can see matches; only the schema differs, which is the part that decides what is emitted.
		expect(() => declareBlips({ ...SCROLL, attributes: z.object({ view: z.string(), extra: z.string() }) })).toThrow(/already declared/);
	});

	it("accepts an equivalent schema written twice, since the two are provably the same", () => {
		declareBlips(SCROLL);
		expect(() => declareBlips({ ...SCROLL, attributes: z.object({ view: z.string() }) })).not.toThrow();
	});

	it("refuses a schema it cannot compare, rather than assuming two unprovable declarations agree", () => {
		const opaque = { ...SCROLL, name: "haibun.test.opaque", attributes: z.string().transform((s) => s.length) };
		declareBlips(opaque);
		expect(() => declareBlips({ ...opaque, attributes: z.string().transform((s) => s.length) })).toThrow(/already declared/);
		expect(() => declareBlips(opaque)).not.toThrow(); // the same schema is still the same declaration
	});

	it("publishes its declarations, so an exporter builds instruments and a reader discovers what a run records", () => {
		declareBlips(SCROLL);
		const found = blipDeclarations().find((d) => d.name === SCROLL.name);
		expect(found).toMatchObject({ instrument: "span-event", unit: "px", dimensions: ["view"] });
	});

	it("carries where a name was declared when it opted in, and keeps that through a same-shape redeclaration", () => {
		declareBlips({ ...SCROLL, name: "haibun.test.with.origin", origin: true });
		declareBlips(SCROLL);
		const traced = blipDeclarations().find((d) => d.name === "haibun.test.with.origin");
		// The declaring site is this test file: the path a reader hands to a source tool.
		expect(traced?.declaredAt).toMatch(/blips\.test\.[jt]s:\d+$/);
		declareBlips({ ...SCROLL, name: "haibun.test.with.origin", origin: true });
		expect(blipDeclarations().find((d) => d.name === "haibun.test.with.origin")?.declaredAt).toBe(traced?.declaredAt);
		expect(blipDeclarations().find((d) => d.name === SCROLL.name)?.declaredAt).toBeUndefined();
	});

	it("stops recording once a subscriber detaches", () => {
		declareBlips(SCROLL);
		const { world, eventLogger } = make();
		const seen: THaibunEvent[] = [];
		const cb = (e: THaibunEvent) => seen.push(e);
		eventLogger.subscribe(cb, { kinds: ["blip"] });
		recordBlip(world, SCROLL.name, 1, { view: "a" });
		eventLogger.unsubscribe(cb);
		recordBlip(world, SCROLL.name, 2, { view: "a" });
		expect(seen.map((e) => (e.kind === "blip" ? e.value : undefined))).toEqual([1]);
	});
});

describe("blip rollup: the aggregating listener", () => {
	const HTTP = { name: "haibun.test.http.request", instrument: "span-event" as const, description: "An observed request completed." };

	beforeEach(resetBlips);

	it("counts occurrences per name while attached, in observation-source shape", () => {
		declareBlips(SCROLL, HTTP);
		const { world, eventLogger } = make("0.1");
		const rollup = new BlipRollup();
		rollup.attach(eventLogger);
		recordBlip(world, SCROLL.name, 1, { view: "a" });
		recordBlip(world, SCROLL.name, 2, { view: "a" });
		recordBlip(world, HTTP.name);
		const { items, metrics } = rollup.observe();
		expect(items.sort()).toEqual([HTTP.name, SCROLL.name].sort());
		expect(metrics[SCROLL.name]).toEqual({ count: 2 });
		expect(metrics[HTTP.name]).toEqual({ count: 1 });
	});

	it("rebinds to the logger it is given, so an execution that never detached cannot deafen the next one", () => {
		declareBlips(SCROLL);
		const first = make("0.1");
		const rollup = new BlipRollup();
		rollup.attach(first.eventLogger);
		recordBlip(first.world, SCROLL.name, 1, { view: "a" });
		// The execution ends without detaching, as a throw escaping the feature loop would leave it.
		const second = make("0.1");
		rollup.attach(second.eventLogger);
		expect(first.eventLogger.hasSubscribers("blip")).toBe(false);
		expect(rollup.observe().items).toEqual([]); // a clean window, not the previous execution's counts
		recordBlip(second.world, SCROLL.name, 1, { view: "a" });
		expect(rollup.observe().metrics[SCROLL.name]).toEqual({ count: 1 });
	});

	it("clears on reset and stops counting on detach, restoring the no-subscriber fast path", () => {
		declareBlips(SCROLL);
		const { world, eventLogger } = make();
		const rollup = new BlipRollup();
		rollup.attach(eventLogger);
		recordBlip(world, SCROLL.name, 1, { view: "a" });
		expect(rollup.observe().metrics[SCROLL.name]).toEqual({ count: 1 });
		rollup.reset();
		expect(rollup.observe().items).toEqual([]);
		rollup.detach();
		expect(eventLogger.hasSubscribers("blip")).toBe(false);
		recordBlip(world, SCROLL.name, 2, { view: "a" });
		expect(rollup.observe().items).toEqual([]);
	});
});
