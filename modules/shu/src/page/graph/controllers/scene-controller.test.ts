// A scene's timers and frames end with the scene: a callback of a frame in progress can end it and request the next frame,
// and that frame and a timer requested before the end don't run on what the end released. A scene connected again runs its
// own requests, and a request of its earlier connection doesn't call back.
import { afterEach, describe, it, expect } from "vitest";
import { manualClock } from "../../../test/setup.js";
import { installClock } from "../../root.js";
import { endPage } from "../../adapters/page-held.js";
import { SceneController } from "./scene-controller.js";

/** A scene's parts over a clock the test advances. */
function partsOverManualClock(): { parts: SceneController; advance(ms: number): void; ran: string[] } {
	const time = manualClock(0);
	installClock(time.clock);
	return { parts: new SceneController(), advance: time.advance, ran: [] };
}

describe("a scene's clock", () => {
	afterEach(() => endPage());

	it("runs each timer and frame requested while the scene runs", () => {
		const { parts, advance, ran } = partsOverManualClock();
		parts.clock.frame(() => ran.push("frame"));
		parts.clock.after(10, () => ran.push("timer"));
		advance(10);
		expect(ran).toEqual(["frame", "timer"]);
	});

	it("doesn't run what a frame requests as it ends the scene mid-frame, or a timer requested before the end", () => {
		const { parts, advance, ran } = partsOverManualClock();
		parts.clock.after(50, () => ran.push("timer before the end"));
		parts.clock.frame(() => {
			ran.push("frame");
			parts.end();
			parts.clock.frame(() => ran.push("next frame"));
			parts.clock.after(0, () => ran.push("timer after the end"));
		});
		advance(100);
		expect(ran).toEqual(["frame"]);
	});

	it("calls back the requests of a scene connected again, and skips those of its earlier connection", () => {
		const { parts, advance, ran } = partsOverManualClock();
		parts.end();
		parts.clock.after(10, () => ran.push("earlier connection"));
		parts.begin();
		parts.clock.after(10, () => ran.push("this connection"));
		advance(10);
		expect(ran).toEqual(["this connection"]);
	});

	it("keeps a request made before the scene first connected", () => {
		const { parts, advance, ran } = partsOverManualClock();
		parts.clock.after(10, () => ran.push("before connecting"));
		parts.begin();
		advance(10);
		expect(ran).toEqual(["before connecting"]);
	});
});
