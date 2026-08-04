import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { declareBlips, recordBlip, resetBlips, blipWatch, WATCH_WINDOW } from "../lib/blips.js";
import { EventLogger } from "../lib/EventLogger.js";
import BlipsStepper, { renderWatch } from "./blips-stepper.js";
import LogicStepper from "./logic-stepper.js";
import VariablesStepper from "./variables-stepper.js";
import Haibun from "./haibun.js";
import { AStepper } from "../lib/astepper.js";
import { OK } from "../schema/protocol.js";
import { failWithDefaults, passWithDefaults } from "../lib/test/lib.js";
import type { TWorld } from "../lib/world.js";

const SCROLL = {
	name: "haibun.test.view.scroll_adjust",
	instrument: "span-event" as const,
	description: "A view moved by itself.",
	unit: "px",
	attributes: z.object({ view: z.string() }),
};
const REQUEST = { name: "haibun.test.http.request", instrument: "span-event" as const, description: "A request completed." };

const make = (seqPath?: string) => {
	const eventLogger = new EventLogger();
	return { eventLogger, world: { runtime: { currentSeqPath: seqPath }, eventLogger } as unknown as TWorld };
};

describe("a watch: which occurrences, in what order", () => {
	beforeEach(() => {
		blipWatch.stop();
		resetBlips();
	});

	it("holds only the watched names, in the order they happened", () => {
		declareBlips(SCROLL, REQUEST);
		const { world, eventLogger } = make("0.1");
		blipWatch.start(eventLogger, [SCROLL.name]);
		recordBlip(world, SCROLL.name, 1, { view: "a" });
		recordBlip(world, REQUEST.name);
		recordBlip(world, SCROLL.name, 2, { view: "b" });
		expect(blipWatch.occurrences().map((b) => b.value)).toEqual([1, 2]);
		expect(blipWatch.occurrences().every((b) => b.name === SCROLL.name)).toBe(true);
	});

	it("collects a whole namespace when watching its prefix", () => {
		declareBlips(SCROLL, REQUEST);
		const { world, eventLogger } = make();
		blipWatch.start(eventLogger, ["haibun.test.http"]);
		recordBlip(world, REQUEST.name);
		recordBlip(world, SCROLL.name, 1, { view: "a" });
		expect(blipWatch.occurrences().map((b) => b.name)).toEqual([REQUEST.name]);
	});

	it("keeps the most recent window and counts what fell out, so a truncation never reads as the whole", () => {
		declareBlips(REQUEST);
		const { world, eventLogger } = make();
		blipWatch.start(eventLogger, [REQUEST.name]);
		const over = WATCH_WINDOW + 25;
		for (let i = 0; i < over; i++) recordBlip(world, REQUEST.name, i);
		const held = blipWatch.occurrences();
		expect(held).toHaveLength(WATCH_WINDOW);
		expect(blipWatch.seen).toBe(over);
		// Oldest first, and the oldest kept is the one just past what the window dropped.
		expect(held[0].value).toBe(over - WATCH_WINDOW);
		expect(held[held.length - 1].value).toBe(over - 1);
		expect(renderWatch(held, blipWatch.seen)).toContain(`showing the most recent ${WATCH_WINDOW}`);
	});

	it("carries the step each occurrence happened under, which is what ties it back to the run", () => {
		declareBlips(SCROLL);
		const { world, eventLogger } = make("0.2.3");
		blipWatch.start(eventLogger, [SCROLL.name]);
		recordBlip(world, SCROLL.name, 4, { view: "a" });
		expect(renderWatch(blipWatch.occurrences(), blipWatch.seen)).toContain("step=0.2.3");
	});

	it("stops collecting when stopped, and restores the no-subscriber fast path", () => {
		declareBlips(SCROLL);
		const { world, eventLogger } = make();
		blipWatch.start(eventLogger, [SCROLL.name]);
		recordBlip(world, SCROLL.name, 1, { view: "a" });
		blipWatch.stop();
		expect(eventLogger.hasSubscribers("blip", SCROLL.name)).toBe(false);
		recordBlip(world, SCROLL.name, 2, { view: "a" });
		expect(blipWatch.occurrences().map((b) => b.value)).toEqual([1]);
	});

	it("starts a fresh window on a new watch, rather than mixing two questions", () => {
		declareBlips(SCROLL);
		const { world, eventLogger } = make();
		blipWatch.start(eventLogger, [SCROLL.name]);
		recordBlip(world, SCROLL.name, 1, { view: "a" });
		blipWatch.start(eventLogger, [SCROLL.name]);
		expect(blipWatch.occurrences()).toHaveLength(0);
		expect(blipWatch.seen).toBe(0);
		recordBlip(world, SCROLL.name, 2, { view: "a" });
		expect(blipWatch.occurrences().map((b) => b.value)).toEqual([2]);
	});

	it("says so plainly when nothing was recorded", () => {
		expect(renderWatch([], 0)).toMatch(/No occurrences/);
	});
});

/** A stepper that records occurrences on demand, standing in for a real emitter so the run-facing path can be tested whole. */
class Emitter extends AStepper {
	steps = {
		scrolled: {
			gwta: "view scrolls {distance: number}",
			action: ({ distance }: { distance: number }) => {
				declareBlips({ ...SCROLL, attributes: z.object({ view: z.string() }) });
				recordBlip(this.getWorld(), SCROLL.name, distance, { view: "a" });
				return Promise.resolve(OK);
			},
		},
	};
}

const STEPPERS = [Haibun, BlipsStepper, LogicStepper, VariablesStepper, Emitter];

describe("the run-facing path: ask to watch, do the work, read what arrived", () => {
	beforeEach(() => {
		blipWatch.stop();
		resetBlips();
	});

	it("watches a name, then reports the occurrences in order with the step each happened under", async () => {
		const feature = {
			path: "/features/test.feature",
			content: `view scrolls 0
watch blips "${SCROLL.name}"
view scrolls 3
view scrolls 7
every occurrence observed in watched blips is "variable occurrence/step exists"
some occurrence observed in watched blips is "variable occurrence/value is 7"
set held from show watched blips
variable held.seen is "2"`,
		};
		// The first scroll happens before the watch and must not be held; the two after it must, in order.
		const result = await passWithDefaults([feature], STEPPERS);
		expect(result.ok).toBe(true);
	});

	it("refuses to watch a name nothing declares, rather than reporting an empty window as an answer", async () => {
		const feature = { path: "/features/test.feature", content: `watch blips "haibun.test.nothing.declares.this"` };
		const result = await failWithDefaults([feature], STEPPERS);
		expect(result.ok).toBe(false);
	});

	it("stops holding occurrences once watching stops", async () => {
		const feature = {
			path: "/features/test.feature",
			content: `view scrolls 0
watch blips "${SCROLL.name}"
view scrolls 3
stop watching blips
view scrolls 9
set held from show watched blips
variable held.seen is "1"`,
		};
		const result = await passWithDefaults([feature], STEPPERS);
		expect(result.ok).toBe(true);
	});

	it("lists what a run can record, so what is worth watching can be discovered rather than guessed", async () => {
		const feature = {
			path: "/features/test.feature",
			content: `view scrolls 1
set declared from show declared blips
matches {declared.text} with "*${SCROLL.name}*"`,
		};
		const result = await passWithDefaults([feature], STEPPERS);
		expect(result.ok).toBe(true);
	});
});
