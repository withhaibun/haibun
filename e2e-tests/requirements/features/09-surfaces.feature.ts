import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import { localOrigin } from "@haibun/core/lib/domains/local-origin.js";
import { requiredModuleOption } from "@haibun/core/lib/held-module-options.js";

const { feature, scenario } = withAction(new Haibun());
const MCP = `${localOrigin(Number(requiredModuleOption("HAIBUN_O_MCPSTEPPER_PORT")))}/mcp`;

export const features: TKirejiExport = {
	"One path for every surface": [
		feature({ feature: "One path for every surface" }),
		`Every surface proves through one entry: the executor (executor.ts:216), RPC (dispatch-call.ts:141), MCP (mcp.ts:59), a call by name from a goal or a walk (call-step.ts:56), the remote stepper proxy (remote-proxy-stepper.ts:16), a model's tool call (spopg turns.ts:333), the LSP's resolver (language-server.ts:160), show steps and the affordances panel (discover-steps.ts, pipelines/goals.ts, affordancesAt), and the step graph's lint (pipelines/goals.ts, lintFindings).
		Accidental, and replaced by the one entry: the transport builders that each validate and build a call (dispatch-call.ts:125, turns.ts:345), and a second matcher in the LSP.`,

		scenario({ scenario: "Show steps lists only what the caller may call" }),
		"Essential, for show steps, MCP and a model. Source: discover-steps.ts and identity-and-capability.feature.ts.",
		'serve mcp tools at "/mcp"',
		'webserver is listening for "surfaces"',
		'accept authority from "ranger" for "TestServer:protected,Read:public"',
		`mcp steps shown at "${MCP}" to "ranger" matching "TestServer-protected" include "TestServer-protectedRpcPing"`,
		`mcp call to "${MCP}" with tool "TestServer-protectedRpcPing" succeeds when signed by "ranger" for "TestServer:protected"`,

		scenario({ scenario: "The affordances on offer read the same rules" }),
		"Essential, for the affordances panel. Source: pipelines/goals.ts, affordancesAt.",
		"show affordances",

		scenario({ scenario: "A model's tool call and a line reach the same term" }),
		`Essential, for a model and the page. Source: docs/reasoner.md, For a model.
		Done for the record: a call writes one SeqPath record, which holds the call's parameters and result, the model and the ask of its turn, its delegation and the read level it ran under (step-records.ts). spopg's ToolCall record is gone, and spopg's update writes each stored ToolCall into its step record.`,
		'the call "VariablesStepper-set" with {"what": "x", "value": "1"} is the line "set x to \\"1\\""',

		scenario({ scenario: "Show steps lists the registry's predicates, and a domain's membership is member_of" }),
		"Essential, for a model and a person writing a formula. Source: predicate-registry.ts and discover-steps.ts.",
		'set shown from show steps matching "member_of" as "definition"',
		'variable shown.predicates.0.name is "member_of"',
		'variable shown.predicates.0.method is "VariablesStepper-isIn"',
		'set membership from the line "\\"soup\\" is in courses" renders from its term as written',
		"matches membership.term with \"'member_of'(*\"",
	],
};
