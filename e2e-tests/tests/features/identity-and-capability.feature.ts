import type { TKirejiExport } from "@haibun/core/kireji/withAction.js";
import { withAction } from "@haibun/core/kireji/withAction.js";
import Haibun from "@haibun/core/steps/haibun.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Identity and capability authorization": [
		feature({ feature: "Identity and capability authorization" }),
		`Every running instance acts as someone. The moment it starts it takes on an identity, written did:site:<id> — a decentralized identifier, a public verifiable name for a person or service that no central registry owns; an operator can override it with a named site key. That site identity is its own root: it vouches for itself, and anything the instance authors is attributed to it.

		A protected action is never allowed on reachability alone. Every invocation — running a feature, an in-process call, a remote call, a tool call — funnels through one gate that asks a single question: does the caller hold the capability this action requires? If not, the action is refused before it runs. A capability is a narrow, revocable permission to perform a named action, following the shape of authorization capabilities for linked data (the controller / allowedAction / delegation / invocation vocabulary): one identity grants another the right to do a specific thing.

		A capability can be presented two ways. The simple in-process way is a bearer grant: an opaque token the instance maps to a set of allowed actions and can revoke at any time; presenting the token authorises those actions. The portable way is a signed capability document that carries its own controller and a cryptographic proof. The instance does not verify that proof itself — verifying signatures, resolving identifiers to keys, and validating a delegation chain are handed to a single pluggable verifier a consumer supplies, so the core stores and compares public material only and never holds a private key. With no verifier registered a signed capability is refused; once one is registered the same document is accepted. The signed path and its scope-narrowing delegation chains are exercised by the consumer's credential and delegation features; the sections below exercise the identity model and the bearer path the core owns.`,

		scenario({ scenario: "The site identity delegates a narrower subkey" }),
		`The site identity can hand out subkeys: child identities scoped to a single permitted action, addressed by extending the site's own address as did:site:<id>:<name>. Issuing a subkey grants its token exactly that one action and records the delegation as public provenance — a node that points back at the site by a delegated-from link and holds no private key. Here the site issues a subkey allowed only the protected action; the subkey's token then authorises exactly that protected step, and nothing wider. The recorded shape of that delegation — a self-issued root, a single delegated-from edge, public material only — is asserted by the core's Principal-persistence checks.`,
		"enable rpc",
		'webserver is listening for "identity subkey delegation"',
		'issue subkey "subkey-ranger" delegated from site key with action "TestServer:protected"',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" succeeds when bearer token is "subkey-ranger"',

		scenario({ scenario: "A capability is granted, scoped, and revoked — enforced over RPC" }),
		`A bearer grant maps a token to the actions it may perform. With no grant the protected step is refused before it runs. Once the token is granted the protected action, the same step at the same endpoint succeeds. A token granted only the protected action is still refused the admin action — each grant is least-privilege, scoped to exactly what was delegated. Revoking the grant denies the same token again. The step definition and the transport never change; only the host's grant state does.`,
		"enable rpc",
		'webserver is listening for "capability over rpc"',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" is denied without capability',
		'issue zcap bearer grant for token "rpc-ranger-token" with action "TestServer:protected"',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" succeeds when bearer token is "rpc-ranger-token"',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedAdminRpcPing" with method "TestServer-protectedAdminRpcPing" is denied for capability "TestServer:admin" when bearer token is "rpc-ranger-token"',
		'revoke zcap bearer grant for token "rpc-ranger-token"',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" is denied when bearer token is "rpc-ranger-token"',

		scenario({ scenario: "The same gate enforces calls arriving over the Model Context Protocol (MCP)" }),
		`Nothing about the capability is transport-specific. The MCP endpoint — the tool interface an external agent uses — admits a configured client token to connect, then reads that same token through the same resolver and feeds it into the same gate, so a host-side grant or revocation flips authorization identically here. The client first connects and discovers the protected tool through the tool index, which is not authority, then the same grant, least-privilege, and revoke lifecycle plays out over the tool call. Grant and revocation take effect only when issued against, and read from, the same running authority: a token authorised against a context that never saw the grant is still refused.`,
		"serve mcp tools at /mcp",
		'webserver is listening for "capability over mcp"',
		'mcp tool index at "http://localhost:8138/mcp" includes "access_stepper_TestServer" when bearer token is "mcp-client-token"',
		'mcp stepper "TestServer" at "http://localhost:8138/mcp" includes tool "TestServer-protectedRpcPing" when bearer token is "mcp-client-token"',
		'mcp call to "http://localhost:8138/mcp" with tool "TestServer-protectedRpcPing" is denied when bearer token is "mcp-client-token"',
		'issue zcap bearer grant for token "mcp-client-token" with action "TestServer:protected"',
		'mcp call to "http://localhost:8138/mcp" with tool "TestServer-protectedRpcPing" succeeds when bearer token is "mcp-client-token"',
		'mcp call to "http://localhost:8138/mcp" with tool "TestServer-protectedAdminRpcPing" is denied for capability "TestServer:admin" when bearer token is "mcp-client-token"',
		'revoke zcap bearer grant for token "mcp-client-token"',
		'mcp call to "http://localhost:8138/mcp" with tool "TestServer-protectedRpcPing" is denied when bearer token is "mcp-client-token"',
	],
};
