import { describe, it, expect } from "vitest";
import { SEQ_PATH_FIELD, RecordNameSchema, SeqPathSchema, compareSeqPath, extractSeqPathPrefix, formatRecordName, parseRecordName, parseSeqPath, seqPathDomainDefinition } from "./seq-path.js";
import { LinkRelations } from "./resources.js";
import { EXECUTION_MODES } from "../schema/protocol.js";

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

	it("refuses an empty segment rather than reading it as a zero", () => {
		// A second reader treated `1..2` as [1, 0, 2], because Number("") is 0 — a step that does not exist, named
		// confidently. An absent segment is not a step number.
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

	it("treats negative segments (e.g. run-root sentinels like -1) as numerically less than positives", () => {
		expect(compareSeqPath([0, -1, 5], [0, 0, 5])).toBe(-1);
	});
});

describe("extractSeqPathPrefix", () => {
	it("returns the input verbatim when it is already a bare seqPath", () => {
		expect(extractSeqPathPrefix("0.1.5.3")).toBe("0.1.5.3");
	});

	it("strips an event-id suffix like .artifact.0 or .lifecycle.42", () => {
		expect(extractSeqPathPrefix("0.1.5.3.artifact.0")).toBe("0.1.5.3");
		expect(extractSeqPathPrefix("0.1.5.3.lifecycle.42")).toBe("0.1.5.3");
	});

	it("preserves the auxiliary-prefix segment (negative integers stay)", () => {
		expect(extractSeqPathPrefix("0.-1.13.1")).toBe("0.-1.13.1");
		expect(extractSeqPathPrefix("0.-1.13.1.artifact")).toBe("0.-1.13.1");
	});

	it("returns null for ids that do not start with a dot-joined integer prefix", () => {
		expect(extractSeqPathPrefix("foo.bar")).toBe(null);
		expect(extractSeqPathPrefix("")).toBe(null);
	});
});

describe("the mode a step ran under", () => {
	// A speculative step's failure is expected and a prose step runs nothing, so a reader looking for what actually went
	// wrong wants the authoritative ones. That is a distinction they can draw only if the mode is on the record, and
	// only offered as a choice beside the type if it is declared as something the type is grouped by.
	it("is offered as a sub-filter, which is what grouped-as declares", () => {
		expect(seqPathDomainDefinition.topology?.properties?.[SEQ_PATH_FIELD.mode]).toBe(LinkRelations.CONTEXT.rel);
	});

	it("accepts every mode a run can be, and nothing else", () => {
		for (const mode of EXECUTION_MODES) {
			expect(SeqPathSchema.safeParse({ id: "0.1", stepText: "a step", actionStatus: "passed", generatedAtTime: "now", mode }).success, mode).toBe(true);
		}
		expect(SeqPathSchema.safeParse({ id: "0.1", stepText: "a step", actionStatus: "passed", generatedAtTime: "now", mode: "invented" }).success).toBe(false);
	});

	it("names speculative among them, since telling it apart is what the filter is for", () => {
		expect(EXECUTION_MODES).toContain("speculative");
	});
});

describe("what names a record of a run", () => {
	it("is one form: the execution it belongs to, the step path within it, and which of that step's it is", () => {
		expect(formatRecordName({ execution: "1700000000000-4", path: [0, 1, 2] })).toBe("1700000000000-4.0.1.2");
		expect(formatRecordName({ execution: "1700000000000-4", path: [0, 1, 2], ordinal: 3 })).toBe("1700000000000-4.0.1.2@3");
		expect(formatRecordName({ execution: "1700000000000-4", path: [] }), "what a run said outside every step").toBe("1700000000000-4");
	});

	it("reads back exactly what was written", () => {
		for (const name of [
			{ execution: "1700000000000-4", path: [0, 1, 2] },
			{ execution: "1700000000000-4", path: [0, -1, 5], ordinal: 0 },
			{ execution: "1700000000000-1", path: [] },
		])
			expect(parseRecordName(formatRecordName(name))).toEqual(name);
	});

	it("names no record where the id is not one, rather than reading it as something else", () => {
		expect(parseRecordName("0.1.2"), "a step path on its own names no execution").toBeUndefined();
		expect(parseRecordName("log.1700000000000")).toBeUndefined();
		expect(parseRecordName("")).toBeUndefined();
	});

	it("is strict about what a name holds, so a second shape cannot creep in", () => {
		expect(RecordNameSchema.safeParse({ execution: "1700000000000-4", path: [0], suffix: "x" }).success).toBe(false);
		expect(RecordNameSchema.safeParse({ execution: "[0.1]", path: [0] }).success).toBe(false);
	});
});
