import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { declareBlips, blipWatch, WATCH_WINDOW } from "../lib/blips.js";
import { recordBlip } from "../lib/record-blip.js";
import BlipsStepper, { renderWatch } from "./blips-stepper.js";
import LogicStepper from "./logic-stepper.js";
import VariablesStepper from "./variables-stepper.js";
import Haibun from "./haibun.js";
import { AStepper } from "../lib/steps/domains/stepper.js";
import { OK } from "../schema/protocol.js";
import { eventHubOfTest, failWithDefaults, passWithDefaults } from "../lib/test/lib.js";
import type { TWorld } from "../lib/actuality/domains/world.js";
import { runInStep } from "../lib/capability-context.js";
import { itemAt } from "../lib/util/item-at.js";

const SCROLL = {
	name: "haibun.test.view.scroll_adjust",
	instrument: "span-event" as const,
	description: "A view adjusted its scroll position without input.",
	unit: "px",
	attributes: z.object({ view: z.string() }),
};
const REQUEST = { name: "haibun.test.http.request", instrument: "span-event" as const, description: "A request completed." };

const make = () => {
	const eventLogger = eventHubOfTest();
	return { eventLogger, world: { runtime: {}, eventLogger } as unknown as TWorld };
};

describe("a watch: which occurrences, in what order", () => {
	beforeEach(() => {
		blipWatch.stop();
	});

	it("holds only the watched names, in the order they happened", () => {
		declareBlips(SCROLL, REQUEST);
		const { world, eventLogger } = make();
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

	it("keeps the most recent window, counts the occurrences it dropped, and marks the rendered window as truncated", () => {
		declareBlips(REQUEST);
		const { world, eventLogger } = make();
		blipWatch.start(eventLogger, [REQUEST.name]);
		const over = WATCH_WINDOW + 25;
		for (let i = 0; i < over; i++) recordBlip(world, REQUEST.name, i);
		const held = blipWatch.occurrences();
		expect(held).toHaveLength(WATCH_WINDOW);
		expect(blipWatch.seen).toBe(over);
		// Occurrences are oldest first. The oldest held occurrence follows the last one the window dropped.
		expect(itemAt(held, 0).value).toBe(over - WATCH_WINDOW);
		expect(itemAt(held, held.length - 1).value).toBe(over - 1);
		expect(renderWatch(held, blipWatch.seen, blipWatch.totals())).toContain(`showing the most recent ${WATCH_WINDOW}`);
	});

	it("carries the running step's seqPath with each occurrence, so the occurrence links to actuality's step", () => {
		declareBlips(SCROLL);
		const { world, eventLogger } = make();
		blipWatch.start(eventLogger, [SCROLL.name]);
		runInStep({ seqPath: "0.2.3", reportsAt: undefined }, () => recordBlip(world, SCROLL.name, 4, { view: "a" }));
		expect(renderWatch(blipWatch.occurrences(), blipWatch.seen, blipWatch.totals())).toContain("step=0.2.3");
	});

	it("stops collecting when stopped, and removes its subscription, so recordBlip returns after one check", () => {
		declareBlips(SCROLL);
		const { world, eventLogger } = make();
		blipWatch.start(eventLogger, [SCROLL.name]);
		recordBlip(world, SCROLL.name, 1, { view: "a" });
		blipWatch.stop();
		expect(eventLogger.hasSubscribers("blip", SCROLL.name)).toBe(false);
		recordBlip(world, SCROLL.name, 2, { view: "a" });
		expect(blipWatch.occurrences().map((b) => b.value)).toEqual([1]);
	});

	it("starts an empty window on a new watch, so two watches don't mix their occurrences", () => {
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

	it("renders that the watch didn't record an occurrence", () => {
		expect(renderWatch([], 0, [])).toMatch(/didn't record an occurrence/);
	});

	it("totals each name and declared dimension over every occurrence recorded, including those the window dropped", () => {
		const MEASURED = { ...SCROLL, name: "haibun.test.view.measured", dimensions: ["view"] as const };
		declareBlips(MEASURED);
		const { world, eventLogger } = make();
		blipWatch.start(eventLogger, [MEASURED.name]);
		for (let i = 0; i < WATCH_WINDOW; i++) recordBlip(world, MEASURED.name, 2, { view: "a" });
		recordBlip(world, MEASURED.name, 7, { view: "b" });
		expect(blipWatch.totals()).toEqual([
			{ name: MEASURED.name, labels: { view: "a" }, count: WATCH_WINDOW, sum: 2 * WATCH_WINDOW, max: 2 },
			{ name: MEASURED.name, labels: { view: "b" }, count: 1, sum: 7, max: 7 },
		]);
		const text = renderWatch(blipWatch.occurrences(), blipWatch.seen, blipWatch.totals());
		expect(text, "the window dropped an occurrence of view a, and the total for view a counts it").toContain(
			`${MEASURED.name} view=a: ${WATCH_WINDOW}, ${2 * WATCH_WINDOW} px in all, largest 2 px`,
		);
		expect(text).toContain(`${MEASURED.name} view=b: 1, 7 px in all, largest 7 px`);
	});

	it("starts its totals afresh on a new watch", () => {
		declareBlips(REQUEST);
		const { world, eventLogger } = make();
		blipWatch.start(eventLogger, [REQUEST.name]);
		recordBlip(world, REQUEST.name);
		blipWatch.start(eventLogger, [REQUEST.name]);
		expect(blipWatch.totals()).toEqual([]);
	});
});

/** A stepper whose `view scrolls` step records a scroll occurrence. These tests use it in place of a real emitter. */
class Emitter extends AStepper {
	description = "Records a scroll blip.";
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

describe("the feature steps: watch blips, record occurrences, and read the watch", () => {
	beforeEach(() => {
		blipWatch.stop();
	});

	it("watches a name, then returns each occurrence in order with its step", async () => {
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
		// The watch doesn't hold the first scroll, which happens before the watch starts. The watch holds the next two scrolls in order.
		const result = await passWithDefaults([feature], STEPPERS);
		expect(result.ok).toBe(true);
	});

	it("refuses to watch a name that isn't declared, and doesn't return an empty window for it", async () => {
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

	it("lists the blips actuality can record, so a feature can find a name to watch", async () => {
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
