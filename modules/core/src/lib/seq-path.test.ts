import { describe, it, expect } from "vitest";
import {
	SEQ_PATH_FIELD,
	RecordNameSchema,
	SeqPathSchema,
	compareSeqPath,
	extractSeqPathPrefix,
	formatRecordName,
	parseRecordName,
	parseSeqPath,
	seqPathDomainDefinition,
	stepLine,
} from "./seq-path.js";
import { LinkRelations, isPersisted } from "./resources.js";
import { EXECUTION_MODES, RECORDED_STATUS } from "../schema/protocol.js";
import { queryableFields } from "./hypermedia.js";

/** Returns the persisted topology a step's record declares. */
const seqPathTopology = () => {
	const { topology } = seqPathDomainDefinition;
	if (!isPersisted(topology)) throw new Error("the step's record doesn't declare a persisted topology");
	return topology;
};

describe("parseSeqPath", () => {
	it("parses a dot-joined seqPath string back to its number tuple", () => {
		expect(parseSeqPath("0.1.2.5")).toEqual([0, 1, 2, 5]);
		expect(parseSeqPath("0.-1.5.1")).toEqual([0, -1, 5, 1]);
		expect(parseSeqPath("0")).toEqual([0]);
	});

	it("returns null for non-seqPath strings", () => {
		expect(parseSeqPath("urn:uuid:abcd")).toBeNull();
		expect(parseSeqPath("did:web:example.com")).toBeNull();
		expect(parseSeqPath("")).toBeNull();
	});

	it("returns null for an empty segment and doesn't read it as a zero", () => {
		// Number("") is 0, so a reader that splits on dots reads `1..2` as [1, 0, 2]. That path names a step that doesn't
		// exist. An empty segment isn't a step number.
		expect(parseSeqPath("1..2")).toBeNull();
		expect(parseSeqPath(".1")).toBeNull();
		expect(parseSeqPath("1.")).toBeNull();
		expect(parseSeqPath("[ 0.1 ]")).toBeNull();
	});
});

describe("compareSeqPath", () => {
	it("orders sibling steps numerically: 0.1 precedes 0.2", () => {
		expect(compareSeqPath([0, 1], [0, 2])).toBe(-1);
		expect(compareSeqPath([0, 2], [0, 1])).toBe(1);
	});

	it("orders parent before child: 0.1 precedes 0.1.0", () => {
		expect(compareSeqPath([0, 1], [0, 1, 0])).toBe(-1);
		expect(compareSeqPath([0, 1, 0], [0, 1])).toBe(1);
	});

	it("equal seqPaths compare equal", () => {
		expect(compareSeqPath([0, 1, 2, 5], [0, 1, 2, 5])).toBe(0);
	});

	it("orders a synthetic seqPath's negative segment before a non-negative segment", () => {
		expect(compareSeqPath([0, -1, 5], [0, 0, 5])).toBe(-1);
	});
});

describe("extractSeqPathPrefix", () => {
	it("returns a bare seqPath unchanged", () => {
		expect(extractSeqPathPrefix("0.1.5.3")).toBe("0.1.5.3");
	});

	it("removes an event-id suffix such as .artifact.0 or .lifecycle.42", () => {
		expect(extractSeqPathPrefix("0.1.5.3.artifact.0")).toBe("0.1.5.3");
		expect(extractSeqPathPrefix("0.1.5.3.lifecycle.42")).toBe("0.1.5.3");
	});

	it("keeps a synthetic seqPath's negative segment", () => {
		expect(extractSeqPathPrefix("0.-1.13.1")).toBe("0.-1.13.1");
		expect(extractSeqPathPrefix("0.-1.13.1.artifact")).toBe("0.-1.13.1");
	});

	it("returns null for an id that doesn't start with a dot-joined integer prefix", () => {
		expect(extractSeqPathPrefix("foo.bar")).toBe(null);
		expect(extractSeqPathPrefix("")).toBe(null);
	});
});

describe("a step's execution mode", () => {
	// A speculative step's failure is expected, so a person looking for a failure selects the authoritative steps. That
	// selection requires the mode on each step's record. The type offers each mode as a sub-filter only where its topology
	// declares the mode `groupedAs`.
	it("is offered as a sub-filter because the topology declares it groupedAs", () => {
		expect(seqPathTopology().properties[SEQ_PATH_FIELD.mode]).toBe(LinkRelations.CONTEXT.rel);
	});

	it("accepts every execution mode and rejects any other value", () => {
		for (const mode of EXECUTION_MODES) {
			expect(SeqPathSchema.safeParse({ id: "0.1", stepText: "a step", actionStatus: "passed", level: "info", generatedAtTime: "now", mode }).success, mode).toBe(true);
		}
		expect(SeqPathSchema.safeParse({ id: "0.1", stepText: "a step", actionStatus: "passed", level: "info", generatedAtTime: "now", mode: "invented" }).success).toBe(false);
	});

	it("includes speculative, so the filter can separate speculative steps from authoritative steps", () => {
		expect(EXECUTION_MODES).toContain("speculative");
	});
});

describe("the name of an execution's record", () => {
	it("has one form: its execution, the step path within that execution, and the record's ordinal within that step", () => {
		expect(formatRecordName({ execution: "1700000000000-4", path: [0, 1, 2] })).toBe("1700000000000-4.0.1.2");
		expect(formatRecordName({ execution: "1700000000000-4", path: [0, 1, 2], ordinal: 3 })).toBe("1700000000000-4.0.1.2@3");
		expect(formatRecordName({ execution: "1700000000000-4", path: [] }), "what an execution logged outside every step").toBe("1700000000000-4");
	});

	it("parses a formatted name back to the same name", () => {
		for (const name of [
			{ execution: "1700000000000-4", path: [0, 1, 2] },
			{ execution: "1700000000000-4", path: [0, -1, 5], ordinal: 0 },
			{ execution: "1700000000000-1", path: [] },
		])
			expect(parseRecordName(formatRecordName(name))).toEqual(name);
	});

	it("returns undefined for an id that doesn't name a record", () => {
		expect(parseRecordName("0.1.2"), "a step path on its own doesn't name an execution").toBeUndefined();
		expect(parseRecordName("log.1700000000000")).toBeUndefined();
		expect(parseRecordName("")).toBeUndefined();
	});

	it("rejects a name with an extra field or a malformed execution", () => {
		expect(RecordNameSchema.safeParse({ execution: "1700000000000-4", path: [0], suffix: "x" }).success).toBe(false);
		expect(RecordNameSchema.safeParse({ execution: "[0.1]", path: [0] }).success).toBe(false);
	});
});

describe("what a step offers as a filter", () => {
	it("includes endedAtTime, so a follower can request the steps that ended after its last read", () => {
		expect(queryableFields({ schema: seqPathDomainDefinition.schema, topology: seqPathTopology() })).toContain("endedAtTime");
	});
});

describe("a step's line", () => {
	const STEP = {
		id: "1700000000000-1.0.1",
		stepText: "the gate checks the ticket",
		called: "GateStepper.check",
		actionStatus: RECORDED_STATUS.completed,
		level: "info",
		generatedAtTime: "2026-01-01T00:00:00.000Z",
		endedAtTime: "2026-01-01T00:00:00.250Z",
		ranVia: "remote",
		ranOn: "https://gate.example",
		capabilityAction: "Check:ticket",
		allowedAction: "Check:ticket",
		performedBy: "did:example:gate",
	};

	it("states the step's words, outcome, times, dispatch and action", () => {
		expect(stepLine(STEP)).toEqual({
			text: "the gate checks the ticket",
			called: "GateStepper.check",
			status: RECORDED_STATUS.completed,
			began: "2026-01-01T00:00:00.000Z",
			ended: "2026-01-01T00:00:00.250Z",
			tookMs: 250,
			dispatch: { via: "remote", on: "https://gate.example" },
			action: { required: "Check:ticket", allowed: "Check:ticket", holder: "did:example:gate" },
		});
	});

	it("leaves out the end, dispatch and action a running step without a capability doesn't state", () => {
		const { endedAtTime, ranVia, ranOn, capabilityAction, allowedAction, performedBy, ...running } = { ...STEP, actionStatus: RECORDED_STATUS.running };
		const line = stepLine(running);
		expect(line.ended).toBeUndefined();
		expect(line.tookMs).toBeUndefined();
		expect(line.dispatch).toBeUndefined();
		expect(line.action).toBeUndefined();
	});

	it("refuses a record that isn't a step's", () => {
		expect(() => stepLine({ id: "x" })).toThrow();
	});
});
