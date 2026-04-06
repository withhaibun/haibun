import type { TKirejiExport } from "@haibun/core/kireji/withAction.js";
import { withAction } from "@haibun/core/kireji/withAction.js";
import Haibun from "@haibun/core/steps/haibun.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Distributed RPC protected stepper with zcap-like grants": [
		feature({ feature: "Distributed RPC protected stepper with zcap-like grants" }),
		`This feature describes the practical distributed path.
		There are two roles in one Haibun run: a distributed host that exposes protected steps over RPC, and a client that calls those steps remotely. The host owns capability state. The client only has a bearer token. RPC is used as the transport for now, but the important contract is the Haibun-level behavior: the same protected step is denied before delegation, allowed after delegation, and denied again after revocation.`,
		scenario({ scenario: "Client cannot invoke a protected distributed step without a delegated capability" }),
		`The distributed host exposes a protected RPC step.
		The client can reach the host, but reachability is not authority. Because no zcap-like bearer grant exists yet, the host must deny execution before the protected step runs.`,
		"enable rpc",
		'webserver is listening for "distributed protected rpc"',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" is denied without capability',
		scenario({ scenario: "Host grants delegated capability and the remote client can invoke the protected step" }),
		`The host now delegates the exact capability required by the protected step to the client's bearer token.
		The client does not call a different endpoint and the host does not expose a second version of the step. The same protected distributed step is invoked through the same RPC path, but authorization now succeeds because the host grant state changed.`,
		"enable rpc",
		'webserver is listening for "distributed protected rpc with grant"',
		'issue zcap-like bearer grant for token "distributed-client-token" with capability "TestServer:protected"',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" succeeds when bearer token is "distributed-client-token"',
		scenario({ scenario: "Least-privilege grant allows only the delegated protected RPC step" }),
		`The host exposes more than one protected remote step.
		The client receives only the TestServer:protected capability, not TestServer:admin. The delegated token must therefore allow the protected RPC step while still being denied on the admin RPC step.`,
		"enable rpc",
		'webserver is listening for "distributed protected rpc least privilege"',
		'issue zcap-like bearer grant for token "distributed-client-token" with capability "TestServer:protected"',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" succeeds when bearer token is "distributed-client-token"',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedAdminRpcPing" with method "TestServer-protectedAdminRpcPing" is denied for capability "TestServer:admin" when bearer token is "distributed-client-token"',
		scenario({ scenario: "Host revokes delegated capability and the remote client loses access again" }),
		`This completes the distributed lifecycle from the point of view of both parties.
		The host revokes the previously delegated capability. The client keeps the same bearer token and calls the same protected distributed step. The call must now fail again, proving that authority is controlled by the distributed host and enforced before dispatch.`,
		"enable rpc",
		'webserver is listening for "distributed protected rpc after revoke"',
		'issue zcap-like bearer grant for token "distributed-client-token" with capability "TestServer:protected"',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" succeeds when bearer token is "distributed-client-token"',
		'revoke zcap-like bearer grant for token "distributed-client-token"',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" is denied when bearer token is "distributed-client-token"',
	],
};
