import { describe, expect, it } from "vitest";
import { SEQ_PATH_EDGE, SEQ_PATH_FIELD } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { VERDICT } from "@haibun/core/lib/domains/protocol.js";
import { FRAME_KIND } from "@haibun/core/lib/records/domains/axioms.js";
import { derivationOf } from "./derivation.js";

const ACTUALITY = "1790000000000-1";
const id = (path: string): string => `${ACTUALITY}.${path}`;
const record = (path: string, stepText: string, verdict: string, more: Record<string, string> = {}) => ({
	[SEQ_PATH_FIELD.id]: id(path),
	[SEQ_PATH_FIELD.stepText]: stepText,
	[SEQ_PATH_FIELD.verdict]: verdict,
	...more,
});
/** A claim's result as its record states it. */
const CLAIMED = "instance retrieval · ∃a. K ⊨ ClassAssertion(SeqPath a) · holds · the witness is SeqPath:s1";
const RECORDS = [
	record("0.1", "ensure It is closed", VERDICT.refuted, { [SEQ_PATH_EDGE.isPartOf]: id("0") }),
	record("0.1.1", 'variable open is "yes"', VERDICT.refuted, {
		[SEQ_PATH_EDGE.isPartOf]: id("0.1"),
		[SEQ_PATH_FIELD.called]: "VariablesStepper.is",
		[SEQ_PATH_FIELD.capabilityAction]: "VariablesStepper:is",
		[SEQ_PATH_FIELD.allowedAction]: "*",
		[SEQ_PATH_FIELD.error]: "open is no",
	}),
	record("0.2", "set open to yes", VERDICT.proved),
	record("0.3", "some SeqPath", VERDICT.proved, { [SEQ_PATH_FIELD.called]: "LogicStepper.someOf", [SEQ_PATH_FIELD.entailment]: CLAIMED }),
];
const isNode = (called: string | undefined): boolean => called === undefined;
/** A statement whose step doesn't state a contract has a proof without frames of its own. */
const UNCHECKED = { assumptions: [], derived: [] };

describe("a derivation's frames", () => {
	const derivation = derivationOf(RECORDS, id("0.1"), isNode, UNCHECKED);

	it("states each record under the statement as an individual frame in proof order, its own record last as the conclusion", () => {
		expect(derivation.frames.map(({ name }) => name)).toEqual([`Individual ${id("0.1.1")}`, `Individual ${id("0.1")}`]);
		expect(derivation.frames[1]?.edges, "the statement's own record is the root of its proof").toEqual([]);
		expect(derivation.frames[0]?.edges).toEqual([{ from: id("0.1.1"), label: SEQ_PATH_EDGE.isPartOf, to: id("0.1") }]);
		expect(derivation.summary).toEqual({ classes: 0, properties: 0, individuals: 2 });
	});

	it("states a call's verdict, the action it required and the actions that allowed it as facts", () => {
		const call = derivation.frames[0];
		expect(call?.statement).toBe('variable open is "yes"');
		expect(call?.dl).toContain(`capabilityAction(<${id("0.1.1")}>, "VariablesStepper:is")`);
		expect(call?.dl).toContain(`allowedAction(<${id("0.1.1")}>, "*")`);
		expect(call?.manchester).toContain(`verdict "${VERDICT.refuted}"`);
	});

	it("opens at the frame of the first goal the proof couldn't prove, with its reason", () => {
		expect([derivation.firstUnmet, derivation.reason, derivation.line]).toEqual(['variable open is "yes"', "open is no", `Individual ${id("0.1.1")}`]);
	});

	it("orders a contract's proof around the records: its assumptions first, then the records under the statement, then what it derived", () => {
		const frame = (name: string) => ({ name, kind: FRAME_KIND.individual, manchester: name, dl: name, statement: name, nodes: [], edges: [] });
		const proved = { assumptions: [frame("assumption 1")], derived: [frame("derived 2"), frame("conclusion 3")] };
		expect(derivationOf(RECORDS, id("0.1"), isNode, proved).frames.map(({ name }) => name)).toEqual([
			"assumption 1",
			`Individual ${id("0.1.1")}`,
			"derived 2",
			"conclusion 3",
			`Individual ${id("0.1")}`,
		]);
	});

	it("states a claim's task, entailment, verdict and witness as a fact of its frame", () => {
		expect(derivationOf(RECORDS, id("0.3"), isNode, UNCHECKED).frames[0]?.manchester).toContain(`entailment ${JSON.stringify(CLAIMED)}`);
	});
});
