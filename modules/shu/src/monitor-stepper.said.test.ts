// What a run says becomes a record under the step that said it, so a reader who was not there to hear it asks for it
// the way they ask for anything else. The record is the durable copy of a statement the reader was already told over
// the stream, which is why writing it announces nothing.
import { describe, it, expect, beforeEach } from "vitest";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LOG_MESSAGE_FIELD, LOG_MESSAGE_LABEL, logMessageDomainDefinition } from "@haibun/core/lib/log-message.js";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";
import MonitorStepper from "./monitor-stepper.js";

const said = (over: Partial<THaibunEvent> = {}): THaibunEvent =>
	({ id: "0.1.2", timestamp: 1700, kind: "log", level: "warn", message: "what it said", ...over }) as unknown as THaibunEvent;

/** The monitor with a store to write to, and its event hook reachable. */
function monitorOver(store: QuadStore): { onEvent: (e: THaibunEvent) => void } {
	const stepper = new MonitorStepper() as unknown as { getWorld: () => unknown; cycles: { onEvent: (e: THaibunEvent) => void } };
	stepper.getWorld = () => ({
		shared: { getStore: () => store },
		eventLogger: { warn: () => undefined, emit: () => undefined },
		domains: { [logMessageDomainDefinition.selectors[0]]: logMessageDomainDefinition },
		runtime: {},
	});
	return { onEvent: (e) => stepper.cycles.onEvent?.(e) };
}

describe("what a run said, as a record", () => {
	let store: QuadStore;
	beforeEach(() => {
		store = new QuadStore();
	});

	it("records the statement, its level, when it was said and the step it was said during", async () => {
		monitorOver(store).onEvent(said());
		await new Promise((r) => setTimeout(r, 0));
		const [record] = await store.queryIndividuals<Record<string, unknown>>(LOG_MESSAGE_LABEL);
		expect(record?.[LOG_MESSAGE_FIELD.message]).toBe("what it said");
		expect(record?.[LOG_MESSAGE_FIELD.level]).toBe("warn");
		expect(record?.[LOG_MESSAGE_FIELD.generatedAtTime]).toBe(new Date(1700).toISOString());
		expect(record?.isPartOf, "the step it was said during").toBe("0.1.2");
	});

	it("keeps two statements of one step apart, including two said in the same millisecond, which a clock cannot tell apart", async () => {
		const monitor = monitorOver(store);
		monitor.onEvent(said({ message: "first", timestamp: 1700 }));
		monitor.onEvent(said({ message: "second", timestamp: 1700 }));
		await new Promise((r) => setTimeout(r, 0));
		const records = await store.queryIndividuals<Record<string, unknown>>(LOG_MESSAGE_LABEL);
		expect(records.map((r) => r[LOG_MESSAGE_FIELD.message]).sort()).toEqual(["first", "second"]);
	});

	it("records nothing for an event that is not something the run said", async () => {
		monitorOver(store).onEvent({ id: "0.1", timestamp: 1700, kind: "lifecycle", level: "info", stage: "end" } as unknown as THaibunEvent);
		await new Promise((r) => setTimeout(r, 0));
		expect(await store.queryIndividuals(LOG_MESSAGE_LABEL)).toEqual([]);
	});

	it("declares that writing it announces nothing, since the run saying it was the announcement", () => {
		expect(logMessageDomainDefinition.topology).toMatchObject({ announceWrites: false });
	});
});
