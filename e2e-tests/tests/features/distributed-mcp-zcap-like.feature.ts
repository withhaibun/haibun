import type { TKirejiExport } from '@haibun/core/kireji/withAction.js';
import { withAction } from '@haibun/core/kireji/withAction.js';
import Haibun from '@haibun/core/steps/haibun.js';

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	'Distributed MCP protected stepper with zcap-like grants': [
		feature({ feature: 'Distributed MCP protected stepper with zcap-like grants' }),
		`This feature proves the same distributed protected-step contract through MCP instead of RPC.
		The transport differs, but the execution root must not. Discovery comes from the shared step registry, the protected step definition is the same, capability enforcement happens before dispatch, and the host-controlled zcap-like grant state decides whether the same remote call is denied or allowed.`,
		scenario({ scenario: 'Client discovers the distributed host and its protected tool through MCP' }),
		`Discovery must be transport-shaped but execution-root neutral.
		The client first sees the stepper at the MCP index, then opens that distributed stepper and sees the protected tool that will later be invoked.`,
		'serve mcp tools at /mcp',
		'webserver is listening for "distributed protected mcp"',
		'mcp tool index at "http://localhost:8138/mcp" includes "access_stepper_TestServer" when bearer token is "mcp-client-token"',
		'mcp stepper "TestServer" at "http://localhost:8138/mcp" includes tool "TestServer-protectedRpcPing" when bearer token is "mcp-client-token"',
		scenario({ scenario: 'Client cannot invoke the protected distributed step over MCP without delegated capability' }),
		`The client can discover the protected tool, but discovery is not authority.
		Without a zcap-like bearer grant, the same protected distributed step must be denied before dispatch.`,
		'serve mcp tools at /mcp',
		'webserver is listening for "distributed protected mcp denied"',
		'mcp call to "http://localhost:8138/mcp" with tool "TestServer-protectedRpcPing" is denied when bearer token is "mcp-client-token"',
		scenario({ scenario: 'Host grants and revokes delegated capability for the same distributed MCP tool' }),
		`This is the same distributed step and the same client bearer token.
		Only the host grant state changes: first it grants the capability and the remote call succeeds, then it revokes that capability and the same remote call fails again.`,
		'serve mcp tools at /mcp',
		'webserver is listening for "distributed protected mcp grant and revoke"',
		'issue zcap-like bearer grant for token "mcp-client-token" with capability "TestServer:protected"',
		'mcp call to "http://localhost:8138/mcp" with tool "TestServer-protectedRpcPing" succeeds when bearer token is "mcp-client-token"',
		scenario({ scenario: 'Least-privilege grant allows only the delegated protected MCP tool' }),
		`The distributed host lists more than one protected MCP tool.
		The client bearer token is granted TestServer:protected but not TestServer:admin. The same discovered remote host must therefore allow TestServer-protectedRpcPing while denying TestServer-protectedAdminRpcPing.`,
		'serve mcp tools at /mcp',
		'webserver is listening for "distributed protected mcp least privilege"',
		'issue zcap-like bearer grant for token "mcp-client-token" with capability "TestServer:protected"',
		'mcp call to "http://localhost:8138/mcp" with tool "TestServer-protectedRpcPing" succeeds when bearer token is "mcp-client-token"',
		'mcp call to "http://localhost:8138/mcp" with tool "TestServer-protectedAdminRpcPing" is denied for capability "TestServer:admin" when bearer token is "mcp-client-token"',
		scenario({ scenario: 'Host revokes delegated capability for the same distributed MCP tool' }),
		`After revocation, the original protected MCP tool must also be denied again.
		This closes the loop after the least-privilege check and proves both scoping and revocation on the same distributed host.`,
		'serve mcp tools at /mcp',
		'webserver is listening for "distributed protected mcp revoke after least privilege"',
		'issue zcap-like bearer grant for token "mcp-client-token" with capability "TestServer:protected"',
		'mcp call to "http://localhost:8138/mcp" with tool "TestServer-protectedRpcPing" succeeds when bearer token is "mcp-client-token"',
		'revoke zcap-like bearer grant for token "mcp-client-token"',
		'mcp call to "http://localhost:8138/mcp" with tool "TestServer-protectedRpcPing" is denied when bearer token is "mcp-client-token"',
	],
};