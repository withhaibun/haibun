import type { TKirejiExport } from '@haibun/core/kireji/withAction.js';
import { withAction } from '@haibun/core/kireji/withAction.js';
import Haibun from '@haibun/core/steps/haibun.js';

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	'RPC zcap-like capability dispatch': [
		feature({ feature: 'RPC zcap-like capability dispatch' }),
		`This feature covers the capability gate on top of Haibun's shared RPC dispatch path.
		What is special here is that the same endpoint, method name, registry lookup, validation, and synthetic-step execution path are used in both calls; the only difference is whether the caller is authenticated with a bearer token that the transport maps to the capability required by the step definition. That bearer-to-capability mapping is intentionally zcap-like rather than a full zcap implementation.`,
		scenario({ scenario: 'Protected RPC requires an explicit capability' }),
		`That makes this more than a normal RPC smoke test.
		It proves that authorization is enforced by the transport before the step runs, which is the foundation needed for limiting agent access and for calling distributed steppers across systems without giving every caller blanket permission to invoke every step. A zcap-like authority can change the bearer-to-capability mapping without changing how protected steps are declared or dispatched.`,
		'enable rpc',
		'webserver is listening for "rpc capability e2e"',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" is denied without capability',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" succeeds when bearer token is "rpc-protected-token"',
		scenario({ scenario: 'Protected RPC can be granted and revoked through a zcap-like bearer grant' }),
		`This scenario keeps the same protected RPC step and the same bearer token, but it moves authorization into a zcap-like grant lifecycle.
		The transport does not change. The step definition does not change. What changes is the zcap-like authority state: the grant is issued, the bearer token works, the grant is revoked, and the same token stops working.`,
		'enable rpc',
		'webserver is listening for "rpc zcap-like capability e2e"',
		'issue zcap-like bearer grant for token "zcap-like-token" with capability "TestServer:protected"',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" succeeds when bearer token is "zcap-like-token"',
		'revoke zcap-like bearer grant for token "zcap-like-token"',
		'rpc call to "http://localhost:8123/rpc/TestServer-protectedRpcPing" with method "TestServer-protectedRpcPing" is denied when bearer token is "zcap-like-token"',
	],
};