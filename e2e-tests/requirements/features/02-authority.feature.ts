import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import { RPC_ROUTE } from "@haibun/core/lib/rpc-wire.js";
import { DEFAULT_PORT } from "@haibun/web-server-hono/domains/web-server.js";
import { localOrigin } from "@haibun/core/lib/domains/local-origin.js";

const { feature, scenario } = withAction(new Haibun());
const RPC = `${localOrigin(DEFAULT_PORT)}${RPC_ROUTE}`;

export const features: TKirejiExport = {
	"Capabilities authorize every call": [
		feature({ feature: "Capabilities authorize every call" }),
		`A call is provable only under a capability that grants its action, and its record names that capability. Authority is checked in the gate of step dispatch (gate.ts:158, step-dispatch.ts:149), the call context (capability-context.ts:40), the session authority (session-authority.ts:26), the request verifier (capability-verifier.ts:26), the remote store's signer (haibun-stepper.ts:137), and spopg's ZcapLdVerifier and HeldProofs.
		Accidental, and replaced by the one gate inside a built-in call: the second gates in dispatch-call.ts:125 and spopg's turns.ts:357, the dispatch depth of 50 and the halt of every later call after it (step-dispatch.ts:27, step-dispatch.ts:118).`,

		scenario({ scenario: "A statement holds less than its caller, and never more" }),
		"Essential, for every surface. A step that reads a variable needs a read action besides its own. Source: authority-stepper.ts:127 and capability-context.ts:160.",
		'holding only "VariablesStepper:set,Read:private", set narrowed to "yes"',
		'not holding only "VariablesStepper:set,Read:private", variable narrowed is "yes"',

		scenario({ scenario: "A signed call holds only what its proof grants, and a refusal names the action to request" }),
		"Essential, for RPC and MCP. Source: gate.ts:153 and identity-and-capability.feature.ts.",
		"enable rpc",
		'webserver is listening for "requirements"',
		'accept authority from "ranger" for "TestServer:protected"',
		`rpc call to "${RPC}TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" without a capability invocation is refused`,
		`rpc call to "${RPC}TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" succeeds when signed by "ranger" for "TestServer:protected"`,
		`rpc call to "${RPC}TestServer-protectedAdminRpcPing" with method "TestServer-protectedAdminRpcPing" is denied for capability "TestServer:admin" when signed by "ranger" for "TestServer:protected"`,

		scenario({ scenario: "A proof names the capability that allowed each call" }),
		"Essential, for every surface. Source: step-records.ts, the fields capabilityAction and allowedAction.",
		'set allowed from show derivation of "holding only \\"VariablesStepper:set\\", set narrowed to \\"yes\\""',
		'variable allowed.calls.0.allowedAction is "VariablesStepper:set"',
	],
};
