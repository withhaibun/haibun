// @vitest-environment jsdom
// The open column must never go stale: when an observation arrives for the individual it shows (e.g. a gantt bar
// dragged to a new time emits its changed startedAtTime), the column re-fetches; observations for other subjects are
// ignored. This exercises the subscription wiring directly (open's fetch path is covered by the other column tests).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";

type Col = { open(id: string, label: string): Promise<void>; setState(p: Record<string, unknown>): void };
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const observation = (subject: string): Record<string, unknown> => ({
	kind: "artifact",
	artifactType: "json",
	json: { quadObservation: { subject, predicate: "startedAtTime", object: "2026-06-05T00:00:00.000Z", namedGraph: "Task" } },
});

describe("shu-entity-column live refresh", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		if (!customElements.get("shu-entity-column")) customElements.define("shu-entity-column", ShuEntityColumn);
		handle = setupShuTest({ dispatch: () => ({}) });
	});
	afterEach(() => handle.teardown());

	const mount = (): { el: Col; opens: string[] } => {
		const el = document.createElement("shu-entity-column") as unknown as Col;
		const opens: string[] = [];
		el.open = (id, label) => {
			opens.push(id);
			el.setState({ individualId: id, persistedAs: label, loading: false });
			return Promise.resolve();
		};
		document.body.appendChild(el as unknown as Node); // onConnected subscribes to the event stream
		return { el, opens };
	};

	it("re-fetches when an observation arrives for its open subject", async () => {
		const { el, opens } = mount();
		await el.open("t1", "Task");
		expect(opens).toEqual(["t1"]);
		handle.emit(observation("t1"));
		await flush();
		expect(opens).toEqual(["t1", "t1"]);
	});

	it("ignores observations for a different subject", async () => {
		const { el, opens } = mount();
		await el.open("t1", "Task");
		handle.emit(observation("someone-else"));
		await flush();
		expect(opens).toEqual(["t1"]);
	});
});
