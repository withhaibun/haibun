import { describe, expect, it } from "vitest";
import { getTestWorldWithOptions, testWithWorld, DEF_PROTO_OPTIONS } from "@haibun/core/lib/test/lib.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { OK } from "@haibun/core/schema/protocol.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { RpcClient } from "@haibun/core/lib/rpc-client.js";
import { PRINCIPAL_LABEL, type TPrincipal } from "@haibun/core/lib/resources.js";
import Haibun from "@haibun/core/steps/haibun.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import ResourcesStepper from "@haibun/core/steps/resources-stepper.js";
import WebServerStepper from "@haibun/web-server-hono/web-server-stepper.js";
import StorageFS from "@haibun/storage-fs/storage-fs.js";
import InstanceStepper from "@haibun/cli/instance-stepper.js";
import MonitorStepper from "./monitor-stepper.js";
import ShuStepper from "./shu-stepper.js";

/**
 * Live two-instance store delegation, in the federate-graph-reads pattern: a launched main instance
 * (the federate-peer fixture, which grants `store.*` to the satellite-store token), and this world as
 * the satellite mounting the main's store for its Principal records. Writes travel through; reads come
 * back; the surface refuses a caller without the delegated capability. The peer only lives for the
 * feature, so every wire probe runs inside it (a capture stepper) and is asserted after.
 */
const PEER_PORT = 8251;
let readBack: TPrincipal | undefined;
let heldByMain: TPrincipal[] | undefined;
let deniedRead: string | undefined;
let deniedWrite: string | undefined;

class StoreDelegationProbeStepper extends AStepper {
	steps = {
		probeDelegatedStore: {
			gwta: "probe the delegated store surface",
			action: async () => {
				readBack = await this.getWorld().shared.getStore().getIndividual<TPrincipal>(PRINCIPAL_LABEL, "did:site:0.1");
				const asDelegate = new RpcClient({ baseUrl: `http://localhost:${PEER_PORT}`, capabilityToken: "satellite-store", timeoutMs: 2_000, retry: { maxAttempts: 1 } });
				const held = await asDelegate.call<{ result: TPrincipal[] }>("store.queryIndividuals", { label: PRINCIPAL_LABEL, filters: { id: "did:site:0.1" } }, []);
				heldByMain = (held as { result: TPrincipal[] }).result;
				const stranger = new RpcClient({ baseUrl: `http://localhost:${PEER_PORT}`, timeoutMs: 2_000, retry: { maxAttempts: 1 } });
				deniedRead = ((await stranger.call<{ error?: string }>("store.queryIndividuals", { label: PRINCIPAL_LABEL }, [])) as { error?: string }).error;
				deniedWrite = ((await stranger.call<{ error?: string }>("store.upsertIndividual", { label: PRINCIPAL_LABEL, data: { id: "intruder" } }, [])) as { error?: string }).error;
				return OK;
			},
		},
	};
}

describe("a satellite keeps records in the main instance's store over live RPC", () => {
	it("mounts the main's store, writes through, reads back, and the surface denies callers without the grant", { timeout: 60_000 }, async () => {
		const port = 8253;
		const world = getTestWorldWithOptions({ ...DEF_PROTO_OPTIONS, moduleOptions: { [getStepperOptionName(WebServerStepper, "PORT")]: String(port) } });
		const feature = {
			path: "/features/remote-store.feature",
			content: `
issue zcap bearer grant for token "launcher" with action "Instance:launch"
with token "launcher", start a haibun instance from "modules/shu/tests/federate-peer" on port ${PEER_PORT} as host 7
use store at "http://localhost:${PEER_PORT}" for "Principal" with token "satellite-store"
name a connecting site
probe the delegated store surface
`,
		};
		const result = await testWithWorld(
			world,
			[feature],
			[Haibun, WebServerStepper, ShuStepper, MonitorStepper, AuthorityStepper, ResourcesStepper, StorageFS, InstanceStepper, StoreDelegationProbeStepper],
		);
		if (!result.ok) throw new Error(JSON.stringify({ failure: result.failure, steps: result.featureResults?.map((f) => f.stepResults.map((s) => [s.in, s.ok])) }, null, 2));

		// The satellite's naming persisted THROUGH the mounted store, and reading back through its own world store (routed to the main) finds it.
		expect(readBack?.controller).toBe("did:site:0.1");
		// The main itself holds the record — asked directly with the delegated token.
		expect(heldByMain).toHaveLength(1);
		// No grant, no access — reads and writes are both refused without the delegated capability.
		expect(deniedRead).toContain("capability store.read required");
		expect(deniedWrite).toContain("capability store.write required");
	});
});
