import type { TKirejiExport } from "@haibun/core/kireji/withAction.js";
import { withAction } from "@haibun/core/kireji/withAction.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { RPC_ROUTE } from "@haibun/core/lib/rpc-wire.js";
import { localOrigin } from "@haibun/core/lib/local-origin.js";
import { WEB_SERVER } from "../backgrounds/int/web-server.feature.ts";

const { feature, scenario } = withAction(new Haibun());

const RPC = `${WEB_SERVER}${RPC_ROUTE}`;
const MCP_PORT = process.env.HAIBUN_O_MCPSTEPPER_PORT;
if (!MCP_PORT) throw new Error("HAIBUN_O_MCPSTEPPER_PORT names the port of the MCP endpoint this feature calls, and isn't set");
const MCP = `${localOrigin(Number(MCP_PORT))}/mcp`;

export const features: TKirejiExport = {
	"Identity and capability authorization": [
		feature({ feature: "Identity and capability authorization" }),
		`Every running instance acts as someone. The moment it starts it takes on an identity, written did:site:<id>: a decentralized identifier, a public verifiable name for a person or service that a central registry doesn't own; an operator can override it with a named site key. Anything the instance authors is attributed to it.

		An action isn't allowed on reachability alone. Every invocation, running a feature, an in-process call, a remote call, a tool call, funnels through one gate that asks a single question: does the caller hold the capability this action requires? If not, the action is refused before it runs. Every step requires one: the action it declares, or, for a step that doesn't declare one, its own name, so a step that its author didn't protect is refused rather than open. Even the list of steps requires an action: a caller is shown only the steps it holds what they require for, so what it reads of the run is what it may call. A capability is a narrow, revocable permission to perform a named action, following the shape of authorization capabilities for linked data: one identity delegates to another the right to do a specific thing.

		A caller holds a capability by presenting proof of it with the request: a signature over the request made with a key a delegation names. The instance does not verify that proof itself. Verifying signatures, resolving identifiers to keys, and validating a delegation chain are handed to a single verifier a consumer registers, so the core doesn't hold a key. A request that doesn't present a proof doesn't hold a capability, and a request whose proof fails is refused before it runs. Here a stand-in takes the consumer's place: it accepts a named holder's request for the actions it was told to, and checks the request's body against the digest the holder sent. The consumer's credential and delegation features exercise the real signatures and chains.`,

		scenario({ scenario: "A statement can hold less than actuality, and never more" }),
		`A feature runs with the run's own authority. A statement narrowed to some actions holds only those, so a caller holding one action and not another is stated in the feature itself: narrowed to the protected action, the protected step runs and the admin step is refused.`,
		'holding only "TestServer:protected", protected rpc ping',
		'not holding only "TestServer:protected", protected admin rpc ping',

		scenario({ scenario: "A caller's proof is verified over RPC, and grants only what it proves" }),
		`The protected step is refused before it runs when a request doesn't present a proof, and so is a step that doesn't declare an action and a method that doesn't name a step, alike, so a caller that didn't prove a capability doesn't learn the run's steps from a refusal. A holder the verifier accepts for the protected action signs its call, and the same step at the same endpoint runs. The same holder is still refused the admin step, since it proved only the protected action. A holder the verifier doesn't accept for an action is refused outright: its proof fails, so the request doesn't run a step.`,
		"enable rpc",
		'webserver is listening for "capability over rpc"',
		'accept authority from "ranger" for "TestServer:protected"',
		`rpc call to "${RPC}TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" presenting nothing is refused`,
		`rpc call to "${RPC}TestServer-rpcPing" with method "TestServer-rpcPing" presenting nothing is refused`,
		`rpc call to "${RPC}TestServer-nothing" with method "TestServer-nothing" presenting nothing is refused`,
		`rpc call to "${RPC}TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" succeeds when signed by "ranger" for "TestServer:protected"`,
		`rpc call to "${RPC}TestServer-protectedAdminRpcPing" with method "TestServer-protectedAdminRpcPing" is denied for capability "TestServer:admin" when signed by "ranger" for "TestServer:protected"`,
		`rpc call to "${RPC}TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" is refused when signed by "stranger" for "TestServer:protected"`,

		scenario({ scenario: "The same gate enforces calls arriving over the Model Context Protocol (MCP)" }),
		`The capability isn't transport-specific. The MCP endpoint, the tool interface an external agent uses, verifies what a request presents over the whole request and runs each tool call under it. The accepted holder, which holds a public read beside the protected action, finds the protected tool among the steps shown to it for a text; calling it without presenting a proof is refused, calling it signed by that holder runs it, and the admin tool stays refused to that holder.`,
		'serve mcp tools at "/mcp"',
		'webserver is listening for "capability over mcp"',
		'accept authority from "ranger" for "TestServer:protected,Read:public"',
		`mcp steps shown at "${MCP}" to "ranger" matching "TestServer-protected" include "TestServer-protectedRpcPing"`,
		`mcp call to "${MCP}" with tool "TestServer-protectedRpcPing" presenting nothing is refused`,
		`mcp call to "${MCP}" with tool "TestServer-protectedRpcPing" succeeds when signed by "ranger" for "TestServer:protected"`,
		`mcp call to "${MCP}" with tool "TestServer-protectedAdminRpcPing" is denied for capability "TestServer:admin" when signed by "ranger" for "TestServer:protected"`,
	],
};
