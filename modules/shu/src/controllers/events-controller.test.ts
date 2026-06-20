// @vitest-environment jsdom
// EventsController owns the one event pathway for a view: backfill the shared log once on connect, re-derive via the
// onChange callback, merge live batches, and (in snapshot-pinned mode) take no live updates. A tiny host exercises it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { html } from "lit";
import { z } from "zod";
import { ShuElement } from "../components/shu-element.js";
import { EventsController } from "./events-controller.js";
import { resetEventsSnapshot, type TEventRecord } from "../events-snapshot.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";

const SCHEMA = z.object({});

class TestHost extends ShuElement<typeof SCHEMA> {
	#events = new EventsController(this, () => this.onEventsChanged());
	changes: string[][] = [];
	get loaded(): boolean {
		return this.#events.loaded;
	}
	constructor() {
		super(SCHEMA, {});
	}
	private onEventsChanged(): void {
		this.changes.push(this.#events.all.map((e) => String(e.id)));
	}
	render() {
		return html``;
	}
}
if (!customElements.get("test-events-host")) customElements.define("test-events-host", TestHost);

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const ev = (i: number): TEventRecord => ({ id: `0.${i}`, timestamp: i, kind: "log", message: `e${i}` });

describe("EventsController", () => {
	let handle: TShuTestHandle;
	let backfillCalls: number;
	beforeEach(() => {
		resetEventsSnapshot();
		backfillCalls = 0;
		handle = setupShuTest({
			dispatch: (method, params) => {
				if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
				backfillCalls++;
				const filter = (params as { filter: { until?: number } }).filter;
				if (filter.until !== undefined) return { events: [], truncated: false }; // nothing older
				return { events: [ev(1), ev(2)], truncated: false };
			},
		});
	});
	afterEach(() => handle.teardown());

	const mount = (attrs: Record<string, string> = {}): TestHost => {
		const el = document.createElement("test-events-host") as TestHost;
		for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
		document.body.appendChild(el); // connect → hostConnected → backfill + subscribe
		return el;
	};

	it("backfills the shared log on connect and re-derives once it lands", async () => {
		const el = mount();
		await flush();
		expect(el.changes.at(-1)).toEqual(["0.1", "0.2"]);
		expect(backfillCalls).toBe(1);
	});

	it("merges a live batch and re-derives", async () => {
		const el = mount();
		await flush();
		handle.emit(ev(3));
		await flush();
		expect(el.changes.at(-1)).toEqual(["0.1", "0.2", "0.3"]);
	});

	it("backfills only once across two hosts (shared cache)", async () => {
		const a = mount();
		const b = mount();
		await flush();
		expect(backfillCalls).toBe(1);
		expect(a.changes.at(-1)).toEqual(["0.1", "0.2"]);
		expect(b.changes.at(-1)).toEqual(["0.1", "0.2"]);
	});

	it("in data-snapshot-time mode takes the backfill but no live updates", async () => {
		const el = mount({ "data-snapshot-time": "5" });
		await flush();
		const afterBackfill = el.changes.length;
		handle.emit(ev(3));
		await flush();
		expect(el.changes.length).toBe(afterBackfill); // pinned: no live re-derive
	});

	it("loaded is false until the backfill resolves, then true — a view shows retrieving, never a false empty", async () => {
		const el = mount();
		expect(el.loaded).toBe(false); // mounted, backfill in flight — must not look "empty"
		await flush();
		expect(el.loaded).toBe(true); // retrieved
	});
});
