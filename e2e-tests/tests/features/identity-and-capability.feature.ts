import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import { withAction } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { RPC_ROUTE } from "@haibun/core/lib/rpc-wire.js";
import { localOrigin } from "@haibun/core/lib/local-origin.js";
import { requiredModuleOption } from "@haibun/core/lib/held-module-options.js";
import { WEB_SERVER } from "../backgrounds/int/web-server.feature.ts";

const { feature, scenario } = withAction(new Haibun());

const RPC = `${WEB_SERVER}${RPC_ROUTE}`;
const MCP = `${localOrigin(Number(requiredModuleOption("HAIBUN_O_MCPSTEPPER_PORT")))}/mcp`;

export const features: TKirejiExport = {
	"Identity and capability authorization": [
		feature({ feature: "Identity and capability authorization" }),
		`Every running instance has an identity. The instance takes the identity did:site:<id> when it starts. The identity is a decentralized identifier. A decentralized identifier is a public, verifiable name for a person or service, and a central registry doesn't own it. An operator can override the identity with a named site key. Everything the instance authors is attributed to that identity.

		Reaching an endpoint doesn't allow an action. One gate checks every invocation. Invocations include running a feature, an in-process call, a remote call and a tool call. The gate checks that the caller holds the capability the action requires. The gate refuses the action before it runs when the caller doesn't hold that capability. Every step requires an action. A step requires the action it declares. A read step that doesn't declare an action requires a read at the level it states, or a private read where it doesn't state one. Any other step that doesn't declare an action requires its own name as its action, so the gate refuses a step that its author didn't protect to every caller that doesn't hold that name. The list of steps requires an action too. The list shows a caller only the steps whose actions the caller holds, so a caller reads only the steps it may call. A capability is a narrow, revocable permission to perform a named action. It follows the shape of authorization capabilities for linked data. One identity delegates a specific action to another identity.

		A caller holds a capability by presenting a proof of it with the request. The proof is a signature over the request. The signature uses a key that a delegation names. The core doesn't verify that proof. A single verifier that a consumer registers verifies signatures, resolves identifiers to keys and validates delegation chains, so the core doesn't hold a key. A request that doesn't present a proof doesn't hold a capability. The gate refuses a request whose proof fails. The request's step doesn't run. A stand-in verifier replaces the consumer's verifier in this feature. The stand-in accepts a request from a named holder for the actions the feature grants that holder. The stand-in checks the request's body against the digest the holder sent. The consumer's credential and delegation features exercise the real signatures and chains.`,

		scenario({ scenario: "A statement can hold less than actuality, and never more" }),
		`A feature runs with actuality's authority. A statement narrowed to some actions holds only those actions. A feature's lines can state a caller that holds one action and doesn't hold another. The protected step runs under a statement narrowed to the protected action. The gate refuses the admin step under the same narrowing.`,
		'holding only "TestServer:protected", protected rpc ping',
		'not holding only "TestServer:protected", protected admin rpc ping',

		scenario({ scenario: "A caller's proof is verified over RPC, and grants only what it proves" }),
		`The gate refuses the protected step before it runs when a request doesn't present a proof. The gate refuses a step that doesn't declare an action in the same way. The gate refuses a method that doesn't name a step in the same way. The three refusals state the same reason, so a refusal doesn't reveal actuality's steps to a caller that didn't prove a capability. A holder that the verifier accepts for the protected action signs its call. The same step at the same endpoint runs for that call. The gate still refuses the admin step to that holder, since the holder proved only the protected action. The gate refuses a request from a holder that the verifier doesn't accept. The holder's proof fails, so the request doesn't run a step.`,
		"enable rpc",
		'webserver is listening for "capability over rpc"',
		'accept authority from "ranger" for "TestServer:protected"',
		`rpc call to "${RPC}TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" without a capability invocation is refused`,
		`rpc call to "${RPC}TestServer-rpcPing" with method "TestServer-rpcPing" without a capability invocation is refused`,
		`rpc call to "${RPC}TestServer-nothing" with method "TestServer-nothing" without a capability invocation is refused`,
		`rpc call to "${RPC}TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" succeeds when signed by "ranger" for "TestServer:protected"`,
		`rpc call to "${RPC}TestServer-protectedAdminRpcPing" with method "TestServer-protectedAdminRpcPing" is denied for capability "TestServer:admin" when signed by "ranger" for "TestServer:protected"`,
		`rpc call to "${RPC}TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" is refused when signed by "stranger" for "TestServer:protected"`,

		scenario({ scenario: "The same gate enforces calls arriving over the Model Context Protocol (MCP)" }),
		`The gate checks a capability the same way on every transport. The MCP endpoint is the tool interface an external agent uses. The endpoint verifies a request's proof against the whole request. That check includes the request's body. The endpoint runs each tool call in the request under the verified authority. The accepted holder holds a public read and the protected action. The steps shown to that holder for a text search include the protected tool. The gate refuses a call to that tool that doesn't present a proof. A call signed by that holder runs the tool. The gate still refuses the admin tool to that holder.`,
		'serve mcp tools at "/mcp"',
		'webserver is listening for "capability over mcp"',
		'accept authority from "ranger" for "TestServer:protected,Read:public"',
		`mcp steps shown at "${MCP}" to "ranger" matching "TestServer-protected" include "TestServer-protectedRpcPing"`,
		`mcp call to "${MCP}" with tool "TestServer-protectedRpcPing" without a capability invocation is refused`,
		`mcp call to "${MCP}" with tool "TestServer-protectedRpcPing" succeeds when signed by "ranger" for "TestServer:protected"`,
		`mcp call to "${MCP}" with tool "TestServer-protectedAdminRpcPing" is denied for capability "TestServer:admin" when signed by "ranger" for "TestServer:protected"`,
	],
};
