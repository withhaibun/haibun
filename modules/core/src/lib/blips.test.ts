import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { declareBlips, blipDeclarations, listenForBlips, recordBlip, resetBlips, type TBlip } from "./blips.js";
import type { TWorld } from "./world.js";

const world = (seqPath?: string) => ({ runtime: { currentSeqPath: seqPath } }) as unknown as TWorld;
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

	it("costs nothing when nothing is listening — a hot path can record unconditionally", () => {
		declareBlips(SCROLL);
		// No listener, and no declaration would even be needed: recording returns before it looks anything up.
		expect(() => recordBlip(world("0.1.2"), "haibun.test.never.declared", 1)).not.toThrow();
	});

	it("hands a recording to every listener, with the step it happened under", () => {
		declareBlips(SCROLL);
		const seen: TBlip[] = [];
		listenForBlips((b) => seen.push(b));
		recordBlip(world("0.1.2.3"), SCROLL.name, 1, { view: "shu-document-column" });
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ name: SCROLL.name, seqPath: "0.1.2.3", value: 1, attributes: { view: "shu-document-column" } });
	});

	it("refuses a name nobody declared, rather than letting a vocabulary grow at the call site", () => {
		listenForBlips(() => undefined);
		expect(() => recordBlip(world(), "haibun.test.undeclared", 1)).toThrow(/not declared/);
	});

	it("refuses attributes that do not match the declaration, so a stray key never reaches an exporter", () => {
		declareBlips(SCROLL);
		listenForBlips(() => undefined);
		expect(() => recordBlip(world(), SCROLL.name, 1, { viewe: "typo" })).toThrow();
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

	it("stops recording once a listener detaches", () => {
		declareBlips(SCROLL);
		const seen: TBlip[] = [];
		const stop = listenForBlips((b) => seen.push(b));
		recordBlip(world(), SCROLL.name, 1, { view: "a" });
		stop();
		recordBlip(world(), SCROLL.name, 2, { view: "a" });
		expect(seen.map((b) => b.value)).toEqual([1]);
	});
});
