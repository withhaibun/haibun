import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { declareBlips, blipDeclarations, recordBlip, resetBlips } from "./blips.js";
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

	it("refuses to redeclare one name as two different things", () => {
		declareBlips(SCROLL);
		expect(() => declareBlips({ ...SCROLL, instrument: "counter", unit: "1" })).toThrow(/already declared/);
		expect(() => declareBlips(SCROLL)).not.toThrow(); // the same shape again is the same declaration
	});

	it("publishes its declarations, so an exporter builds instruments and a reader discovers what a run records", () => {
		declareBlips(SCROLL);
		const found = blipDeclarations().find((d) => d.name === SCROLL.name);
		expect(found).toMatchObject({ instrument: "span-event", unit: "px", dimensions: ["view"] });
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
