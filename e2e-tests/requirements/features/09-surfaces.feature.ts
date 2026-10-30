import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import { declarations } from "@haibun/core/waypoints/backgrounds/declarations.feature.ts";
import { localOrigin } from "@haibun/core/lib/domains/local-origin.js";
import { requiredModuleOption } from "@haibun/core/lib/held-module-options.js";

const { feature, scenario } = withAction(new Haibun());
const MCP = `${localOrigin(Number(requiredModuleOption("HAIBUN_O_MCPSTEPPER_PORT")))}/mcp`;

export const features: TKirejiExport = {
	"One path for every surface": [
		feature({ feature: "One path for every surface" }),
		`Every surface proves through one entry: the executor (executor.ts:216), RPC (dispatch-call.ts:141), MCP (mcp.ts:59), a call by name from a goal or a walk (call-step.ts:56), the remote stepper proxy (remote-proxy-stepper.ts:16), a model's tool call, the LSP's resolver (language-server.ts:160), show steps and the affordances panel (discover-steps.ts, pipelines/goals.ts, affordancesAt), and the step graph's lint (pipelines/goals.ts, lintFindings).
		Accidental, and replaced by the one entry: the transport builders that each validate and build a call (dispatch-call.ts:125), and a second matcher in the LSP.`,

		scenario({ scenario: "Show steps lists only what the caller may call" }),
		"Essential, for show steps, MCP and a model. Source: discover-steps.ts and identity-and-capability.feature.ts.",
		'serve mcp tools at "/mcp"',
		'webserver is listening for "surfaces"',
		'accept authority from "ranger" for "TestServer:protected,Read:public"',
		`mcp steps shown at "${MCP}" to "ranger" matching "TestServer-protected" include "TestServer-protectedRpcPing"`,
		`mcp call to "${MCP}" with tool "TestServer-protectedRpcPing" succeeds when signed by "ranger" for "TestServer:protected"`,

		scenario({ scenario: "The applicable steps read the same rules" }),
		"Essential, for the affordances panel. Source: pipelines/goals.ts, affordancesAt.",
		"show the applicable steps",
		"The same affordances read over the facts that held at an earlier step, as a step records them and as a page reads them.",
		'as of "0.1", show the applicable steps',
		'as of "0.1", applicable steps',

		scenario({ scenario: "A model's tool call and a line reach the same term" }),
		`Essential, for a model and the page. Source: docs/reasoner.md, For a model.
		Done for the record: a call writes one SeqPath record, which holds the call's parameters and result, the model and the ask of its turn, its delegation and the read level it ran under (step-records.ts).`,
		'the call "VariablesStepper-set" with {"what": "x", "value": "1"} is the line "set x to \\"1\\""',

		scenario({ scenario: "The step definitions list the registry's predicates, and a domain's membership is member_of" }),
		"Essential, for a model and a person writing a formula. Source: predicate-registry.ts and discover-steps.ts.",
		"set shown from show step definitions",
		'matches shown.predicates with "*\\"name\\":\\"member_of\\"*\\"method\\":\\"VariablesStepper-isIn\\"*"',
		'set membership from the line "\\"soup\\" is in courses" renders from its term as written',
		"matches membership.term with \"'member_of'(*\"",

		scenario({ scenario: "A list a read returns is narrowed, ordered, skipped, limited, counted and iterated by combinators that compose with the read" }),
		"Essential, for a person, a model and the page reading a list. Source: domains/lists.ts and the combinators of haibun-stepper.ts.",
		'set first from limited to 1, ordered by "method", matching "Haibun-show", show steps',
		'variable first.steps.0.method is "Haibun-showStepDefinitions"',
		"set counted from counting show steps",
		'variable counted.total is more than "3"',
		'set last from limited to 1, ordered by "method" descending, matching "Haibun-show", show steps',
		'variable last.steps.0.method is "Haibun-showSteps"',
		'set second from limited to 1, skipping 1, ordered by "method", matching "Haibun-show", show steps',
		'variable second.steps.0.method is "Haibun-showSteps"',
		'exactly 2, matching "Haibun-show", show steps',
		'at least 3, whose "stepperName" matches "Haibun", show steps',
		'set each from limited to 1 per "stepperName", show steps',
		'variable each.total is more than "3"',
		"set asOf from as of 0.1, counting show steps",
		'variable asOf.total is more than "3"',
		'for each step of whose "method" matches "Haibun-show", show steps: matching step/method, show steps',
		declarations.shows,
	],
};
