import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Records, events and actualities": [
		feature({ feature: "Records, events and actualities" }),
		`Every call writes a SeqPath record at its start and end, each level writes a record, the lifecycle events move the actuality machine, and actualities.json holds each group's outcome against the state it read (step-dispatch.ts:287-296, lifecycle-events.ts, actualities.ts). Monitor-otel, JUnit, the monitor and the graph view read them. A comparison runs the same features before and after the engine and compares the records' called, stepText and actionStatus by path, the events' kinds and statuses, the JUnit test cases and the actualities entries without durations.
		Accidental, and replaced by the parent predicate of a record: the speculative mode, its negative path segments and the mode field (49 references in 18 files, seq-path.ts:27), the OTel attribute haibun.speculative.failed (monitor-otel-stepper.ts:146), and declaredStepTextHash (executor.ts).`,

		scenario({ scenario: "A call's record states what it called and how long it took" }),
		"Essential, for every view. Source: haibun-stepper.ts:180 and step-records.ts.",
		'set timed from duration of set recorded to "yes"',
		'variable timed.called is "VariablesStepper.set"',
		"variable timed.durationMs is less than 1000",

		scenario({ scenario: "A read made from outside isn't recorded as actuality's step" }),
		"Essential, for observation from outside. Only step-dispatch.test.ts holds it today. Source: step-dispatch.ts:88.",
		'a read of "Haibun-showSteps" over RPC leaves no record',

		scenario({ scenario: "A proof writes its nodes as records under the line that requested it" }),
		"Essential, for the monitor and graph view. Source: docs/reasoner.md, Proofs as SeqPath records.",
		'set nodes from show derivation of "ensure Runs are counted"',
		"variable nodes.records.0.isPartOf exists",
	],
};
