import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import { RPC_ROUTE } from "@haibun/core/lib/rpc-wire.js";
import { DEFAULT_PORT } from "@haibun/web-server-hono/domains/web-server.js";
import { localOrigin } from "@haibun/core/lib/domains/local-origin.js";

const { feature, scenario } = withAction(new Haibun());
const RPC = `${localOrigin(DEFAULT_PORT)}${RPC_ROUTE}`;
const ORIGIN = localOrigin(DEFAULT_PORT);
const capability = (id: string, allowedAction: string[], more: Record<string, string> = {}) =>
	JSON.stringify({ id, controller: "ranger", invocationTarget: ORIGIN, allowedAction, ...more, proof: { type: "stand-in" } });
const CAPABILITY = capability("urn:capability:ranger-sets", ["VariablesStepper:set", "Read:private"]);
const NESTING = capability("urn:capability:ranger-nests", ["AuthorityStepper:holdingCapability", "VariablesStepper:set", "Read:private"]);
const SETS_ONLY = capability("urn:capability:ranger-sets-only", ["VariablesStepper:set", "Read:private"]);
const ELSEWHERE = capability("urn:capability:ranger-elsewhere", ["VariablesStepper:set", "Read:private"], { invocationTarget: "https://elsewhere.example" });
const EXPIRED = capability("urn:capability:ranger-expired", ["VariablesStepper:set", "Read:private"], { expires: "2020-01-01T00:00:00.000Z" });
const AT = `at "${ORIGIN}"`;

export const features: TKirejiExport = {
	"Capabilities authorize every call": [
		feature({ feature: "Capabilities authorize every call" }),
		`A call is provable only under a capability that grants its action, and its record names that capability. Authority is checked in the gate of step dispatch (gate.ts:158, step-dispatch.ts:149), the call context (capability-context.ts:40), the session authority (session-authority.ts:26), the request verifier (capability-verifier.ts:26), and the remote store's signer (haibun-stepper.ts:137).
		Accidental, and replaced by the one gate inside a built-in call: the second gate in dispatch-call.ts:125, the dispatch depth of 50 and the halt of every later call after it (step-dispatch.ts:27, step-dispatch.ts:118).`,

		scenario({ scenario: "A statement holds less than its caller, and never more" }),
		"Essential, for every surface. A step that reads a variable needs a read action besides its own. Source: authority-stepper.ts:127 and capability-context.ts:160.",
		'holding only "VariablesStepper:set,Read:private", set narrowed to "yes"',
		'set narrowedRefusal from maybe holding only "VariablesStepper:set,Read:private", variable narrowed is "yes"',
		'variable narrowedRefusal.lacksAction is "VariablesStepper:is"',

		scenario({ scenario: "A signed call holds only what its proof grants, and a refusal names the action to request" }),
		"Essential, for RPC and MCP. Source: gate.ts:153 and identity-and-capability.feature.ts.",
		'webserver is listening for "requirements"',
		'accept authority from "ranger" for "TestServer:protected"',
		`rpc call to "${RPC}TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" without a capability invocation is refused`,
		`rpc call to "${RPC}TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" succeeds when signed by "ranger" for "TestServer:protected"`,
		`rpc call to "${RPC}TestServer-protectedAdminRpcPing" with method "TestServer-protectedAdminRpcPing" is denied for capability "TestServer:admin" when signed by "ranger" for "TestServer:protected"`,

		scenario({ scenario: "A presented capability allows only the actions it delegates" }),
		"Essential, for a page and another instance that present a capability. The verifier checks the presenter against the document's controller. Source: authority-stepper.ts, holdingCapability.",
		'accept authority from "ranger" for "VariablesStepper:set,Read:private"',
		`holding capability ${CAPABILITY} ${AT}, set presented to "yes"`,
		'variable presented is "yes"',
		`set presentedRefusal from maybe holding capability ${CAPABILITY} ${AT}, variable presented is "yes"`,
		'variable presentedRefusal.lacksAction is "VariablesStepper:is"',

		scenario({ scenario: "A presented capability covers only its target, until it expires" }),
		"Essential, for a page and another instance that present a capability. The reasoner proves the use at its target and time contained in the capability, as ODRL reads it, and a refusal names what exceeds it. Source: authority-stepper.ts, holdingCapability, and logic's containment.ts.",
		'accept authority from "ranger" for "VariablesStepper:set,Read:private"',
		`set elsewhere from maybe holding capability ${ELSEWHERE} ${AT}, set elsewhere to "yes"`,
		`matches elsewhere.refusal with "*exceeds the capability by target ${ORIGIN}*"`,
		`set expired from maybe holding capability ${EXPIRED} ${AT}, set expired to "yes"`,
		'matches expired.refusal with "*exceeds the capability by expires*"',

		scenario({ scenario: "A capability presented inside another parses one way and holds only what it delegates" }),
		"Essential, for a page that presents a capability within a statement another capability allows. Each quoted term ends at its own closing quote, so the outer target doesn't take the inner capability. Source: named-vars.ts, quotedGroup.",
		'accept authority from "ranger" for "AuthorityStepper:holdingCapability,VariablesStepper:set,Read:private"',
		`holding capability ${NESTING} ${AT}, holding capability ${SETS_ONLY} ${AT}, set nested to "yes"`,
		'variable nested is "yes"',
		`set nestedRefusal from maybe holding capability ${NESTING} ${AT}, holding capability ${SETS_ONLY} ${AT}, variable nested is "yes"`,
		'variable nestedRefusal.lacksAction is "VariablesStepper:is"',

		scenario({ scenario: "A source read above the held capability is refused with the read to request" }),
		"Essential, for every surface. A quantifier reads its observation source under what its statement holds, and a statement that doesn't hold a read action doesn't read records. Source: prove.ts, members, and capability-context.ts, WITHOUT_READ.",
		'set observed from show derivation of "holding only \\"LogicStepper:everyObserved,VariablesStepper:matches\\", every step observed in steps is matches {step} with \\"*\\""',
		'variable observed.verdict is "unknown"',
		'matches observed.reason with "*(request Read:public from a key that delegates it)"',

		scenario({ scenario: "A proof names the capability that allowed each call" }),
		"Essential, for every surface. Source: step-records.ts, the fields capabilityAction and allowedAction.",
		'set allowed from show derivation of "holding only \\"VariablesStepper:set\\", set narrowed to \\"yes\\""',
		'variable allowed.calls.0.allowedAction is "VariablesStepper:set"',
	],
};
