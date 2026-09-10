// What a run says becomes a record under the step that said it, so a reader who was not there to hear it asks for it
// the way they ask for anything else. The record is the durable copy of a statement the reader was already told over
// the stream, which is why writing it announces nothing.
import { describe, it, expect, beforeEach } from "vitest";
import { executionOf, formatRecordName } from "@haibun/core/lib/seq-path.js";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LOG_MESSAGE_FIELD, LOG_MESSAGE_LABEL, logMessageDomainDefinition } from "@haibun/core/lib/log-message.js";
import { RUN_ARTIFACT_FIELD, RUN_ARTIFACT_LABEL, runArtifactDomainDefinition } from "@haibun/core/lib/run-artifact.js";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";
import MonitorStepper from "./monitor-stepper.js";

const said = (over: Partial<THaibunEvent> = {}): THaibunEvent =>
	({ id: "0.1.2", timestamp: 1700, kind: "log", level: "warn", message: "what it said", ...over }) as unknown as THaibunEvent;

/** The run these records belong to: one feature of one process, which is what an execution is. */
const TAG = { key: "1700000000000", featureNum: 1 };

/** The monitor with a store to write to, its event hook reachable, and the end of a feature to wait on. Recording is
 *  started from the event hook, which returns before the store has the record; the feature ends with every record
 *  written, so that is what a reader of the store waits for. */
function monitorOver(store: QuadStore): { onEvent: (e: THaibunEvent) => void; ended: () => Promise<void> } {
	const stepper = new MonitorStepper() as unknown as {
		getWorld: () => unknown;
		cycles: { onEvent: (e: THaibunEvent) => void; endFeature: (ended: { shouldClose: boolean }) => Promise<void> };
	};
	stepper.getWorld = () => ({
		tag: TAG,
		shared: { getStore: () => store },
		eventLogger: { warn: () => undefined, emit: () => undefined },
		domains: { [logMessageDomainDefinition.selectors[0]]: logMessageDomainDefinition, [runArtifactDomainDefinition.selectors[0]]: runArtifactDomainDefinition },
		runtime: {},
	});
	return { onEvent: (e) => stepper.cycles.onEvent?.(e), ended: () => stepper.cycles.endFeature({ shouldClose: true }) };
}

describe("what a run said, as a record", () => {
	let store: QuadStore;
	beforeEach(() => {
		store = new QuadStore();
	});

	it("records the statement, its level, when it was said and the step it was said during", async () => {
		const monitor = monitorOver(store);
		monitor.onEvent(said());
		await monitor.ended();
		const [record] = await store.queryIndividuals<Record<string, unknown>>(LOG_MESSAGE_LABEL);
		expect(record?.[LOG_MESSAGE_FIELD.message]).toBe("what it said");
		expect(record?.[LOG_MESSAGE_FIELD.level]).toBe("warn");
		expect(record?.[LOG_MESSAGE_FIELD.generatedAtTime]).toBe(new Date(1700).toISOString());
		expect(record?.isPartOf, "the step it was said during").toBe(formatRecordName({ execution: executionOf(TAG), path: [0, 1, 2] }));
	});

	it("keeps two statements of one step apart, including two said in the same millisecond, which a clock cannot tell apart", async () => {
		const monitor = monitorOver(store);
		monitor.onEvent(said({ message: "first", timestamp: 1700 }));
		monitor.onEvent(said({ message: "second", timestamp: 1700 }));
		await monitor.ended();
		const records = await store.queryIndividuals<Record<string, unknown>>(LOG_MESSAGE_LABEL);
		expect(records.map((r) => r[LOG_MESSAGE_FIELD.message]).sort()).toEqual(["first", "second"]);
	});

	it("records nothing for an event that is not something the run said", async () => {
		const monitor = monitorOver(store);
		monitor.onEvent({ id: "0.1", timestamp: 1700, kind: "lifecycle", level: "info", stage: "end" } as unknown as THaibunEvent);
		await monitor.ended();
		expect(await store.queryIndividuals(LOG_MESSAGE_LABEL)).toEqual([]);
	});

	it("belongs to the step it was said during, named as any record of the run is named", async () => {
		const store = new QuadStore();
		const monitor = monitorOver(store);
		monitor.onEvent(said({ id: "0.-1.525", message: "what went wrong" }));
		await monitor.ended();
		const [record] = await store.queryIndividuals<Record<string, unknown>>(LOG_MESSAGE_LABEL);
		expect(record?.isPartOf).toBe(formatRecordName({ execution: executionOf(TAG), path: [0, -1, 525] }));
		expect(record?.id, "its own name is that step's, and which of what it said this is").toBe(formatRecordName({ execution: executionOf(TAG), path: [0, -1, 525], ordinal: 0 }));
	});

	it("ends the feature with every record written, since the store closes as the feature ends", async () => {
		// A write that has not reached the store when the feature ends is a statement the run made and does not hold.
		// This store holds its write open until the case lets it finish, so the feature can only end after it.
		let finish: () => void = () => undefined;
		const held = new Promise<void>((release) => {
			finish = release;
		});
		const writes = store.upsertIndividual.bind(store);
		store.upsertIndividual = async (label: string, data: unknown) => {
			await held;
			return await writes(label, data);
		};
		const monitor = monitorOver(store);
		monitor.onEvent(said({ message: "said just before the feature ends" }));
		let ended = false;
		const ending = monitor.ended().then(() => {
			ended = true;
		});
		await new Promise((ran) => setImmediate(ran));
		expect(ended, "the feature has not ended while a record write is under way").toBe(false);
		finish();
		await ending;
		expect((await store.queryIndividuals(LOG_MESSAGE_LABEL)).length, "the record the feature waited for").toBe(1);
	});

	it("declares that writing it announces nothing, since the run saying it was the announcement", () => {
		expect(logMessageDomainDefinition.topology).toMatchObject({ announceWrites: false });
	});
});

describe("what a run produced, as a record", () => {
	// An artifact is a file; the record of it says where it is and what it is, and points at the step that produced it.
	let store: QuadStore;
	beforeEach(() => {
		store = new QuadStore();
	});

	it("records where it is, what it is and the step that produced it", async () => {
		const monitor = monitorOver(store);
		monitor.onEvent({
			id: "0.1.2",
			timestamp: 1700,
			kind: "artifact",
			level: "info",
			artifactType: "image",
			path: "/artifacts/shot.png",
			featureRelativePath: "./image/shot.png",
			mimetype: "image/png",
		} as unknown as THaibunEvent);
		await monitor.ended();
		const [record] = await store.queryIndividuals<Record<string, unknown>>(RUN_ARTIFACT_LABEL);
		expect(record).toMatchObject({
			[RUN_ARTIFACT_FIELD.artifactType]: "image",
			[RUN_ARTIFACT_FIELD.path]: "/artifacts/shot.png",
			[RUN_ARTIFACT_FIELD.featureRelativePath]: "./image/shot.png",
			[RUN_ARTIFACT_FIELD.mediaType]: "image/png",
			isPartOf: formatRecordName({ execution: executionOf(TAG), path: [0, 1, 2] }),
		});
	});

	it("keeps two produced in one millisecond apart", async () => {
		const monitor = monitorOver(store);
		const shot = (path: string) => ({ id: "0.1", timestamp: 1700, kind: "artifact", level: "info", artifactType: "image", path }) as unknown as THaibunEvent;
		monitor.onEvent(shot("/artifacts/one.png"));
		monitor.onEvent(shot("/artifacts/two.png"));
		await monitor.ended();
		expect((await store.queryIndividuals(RUN_ARTIFACT_LABEL)).length).toBe(2);
	});

	it("records nothing for what says where nothing is: a quad a store announces, or a trace of the run's own machinery", async () => {
		const monitor = monitorOver(store);
		monitor.onEvent({ id: "0.1", timestamp: 1700, kind: "artifact", level: "debug", artifactType: "json", json: {} } as unknown as THaibunEvent);
		monitor.onEvent({ id: "http-trace-1", timestamp: 1700, kind: "artifact", level: "debug", artifactType: "http-trace", trace: {} } as unknown as THaibunEvent);
		await monitor.ended();
		expect(await store.queryIndividuals(RUN_ARTIFACT_LABEL), "an artifact is a file, and a record of it points at that file").toEqual([]);
	});
});
