import type { TKirejiExport } from "@haibun/core/kireji/withAction.js";
import { withAction } from "@haibun/core/kireji/withAction.js";
import Haibun from "@haibun/core/steps/haibun.js";

const { feature, scenario } = withAction(new Haibun());

const RPC = "http://localhost:8123/rpc";
const MCP = "http://localhost:8138/mcp";

export const features: TKirejiExport = {
	"Identity and capability authorization": [
		feature({ feature: "Identity and capability authorization" }),
		`Every running instance acts as someone. The moment it starts it takes on an identity, written did:site:<id>: a decentralized identifier, a public verifiable name for a person or service that no central registry owns; an operator can override it with a named site key. Anything the instance authors is attributed to it.

		A protected action is never allowed on reachability alone. Every invocation, running a feature, an in-process call, a remote call, a tool call, funnels through one gate that asks a single question: does the caller hold the capability this action requires? If not, the action is refused before it runs. A capability is a narrow, revocable permission to perform a named action, following the shape of authorization capabilities for linked data: one identity delegates to another the right to do a specific thing.

		A caller holds a capability by presenting proof of it with the request: a signature over the request made with a key a delegation names. The instance does not verify that proof itself. Verifying signatures, resolving identifiers to keys, and validating a delegation chain are handed to a single verifier a consumer registers, so the core holds no key. A request presenting nothing holds nothing, and a request whose proof fails is refused before it runs. Here a stand-in takes the consumer's place: it accepts a named holder's request for the actions it was told to, and checks the request's body against the digest the holder sent. The consumer's credential and delegation features exercise the real signatures and chains.`,

		scenario({ scenario: "A statement can hold less than the run, and never more" }),
		`A feature runs with the run's own authority. A statement narrowed to some actions holds only those, so a caller holding one action and not another is stated in the feature itself: narrowed to the protected action, the protected step runs and the admin step is refused.`,
		'holding only "TestServer:protected", protected rpc ping',
		'not holding only "TestServer:protected", protected admin rpc ping',

		scenario({ scenario: "A caller's proof is verified over RPC, and grants only what it proves" }),
		`With nothing presented, the protected step is refused before it runs. A holder the verifier accepts for the protected action signs its call, and the same step at the same endpoint runs. The same holder is still refused the admin step, since what it proved is the protected action and nothing wider. A holder the verifier accepts nothing for is refused outright: its proof fails, so the request runs nothing.`,
		"enable rpc",
		'webserver is listening for "capability over rpc"',
		'accept authority from "ranger" for "TestServer:protected"',
		`rpc call to "${RPC}/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" is denied without capability`,
		`rpc call to "${RPC}/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" succeeds when signed by "ranger" for "TestServer:protected"`,
		`rpc call to "${RPC}/TestServer-protectedAdminRpcPing" with method "TestServer-protectedAdminRpcPing" is denied for capability "TestServer:admin" when signed by "ranger" for "TestServer:protected"`,
		`rpc call to "${RPC}/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" is refused when signed by "stranger" for "TestServer:protected"`,

		scenario({ scenario: "The same gate enforces calls arriving over the Model Context Protocol (MCP)" }),
		`Nothing about the capability is transport-specific. The MCP endpoint, the tool interface an external agent uses, verifies what a request presents over the whole request and runs each tool call under it. A client finds the protected tool in the tool list and among the steps shown for a text, neither of which is authority; calling it presenting nothing is refused, calling it signed by the accepted holder runs it, and the admin tool stays refused to that holder.`,
		"serve mcp tools at /mcp",
		'webserver is listening for "capability over mcp"',
		'accept authority from "ranger" for "TestServer:protected"',
		`mcp tools at "${MCP}" include "TestServer-protectedRpcPing"`,
		`mcp steps shown at "${MCP}" matching "TestServer-protected" include "TestServer-protectedRpcPing"`,
		`mcp call to "${MCP}" with tool "TestServer-protectedRpcPing" presenting nothing is denied for capability "TestServer:protected"`,
		`mcp call to "${MCP}" with tool "TestServer-protectedRpcPing" succeeds when signed by "ranger" for "TestServer:protected"`,
		`mcp call to "${MCP}" with tool "TestServer-protectedAdminRpcPing" is denied for capability "TestServer:admin" when signed by "ranger" for "TestServer:protected"`,
	],
};
