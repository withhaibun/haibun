import { describe, expect, it } from "vitest";
import { getTestWorldWithOptions, testWithWorld, DEF_PROTO_OPTIONS } from "@haibun/core/lib/test/lib.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { OK } from "@haibun/core/lib/domains/protocol.js";
import { getStepperOptionName } from "@haibun/core/lib/domains/util.js";
import { activeSitePrincipal } from "@haibun/core/lib/domains/host-id.js";
import { PRINCIPAL_LABEL } from "@haibun/core/lib/domains/resources.js";
import { recordOf } from "@haibun/core/lib/records/pipelines/record-reads.js";
import type { TClusteredQuads } from "@haibun/core/lib/quad-types.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import FakeAuthorityStepper from "@haibun/core/lib/test/fake-authority.js";
import ResourcesStepper from "@haibun/core/steps/resources-stepper.js";
import WebServerStepper from "@haibun/web-server-hono/web-server-stepper.js";
import StorageFS from "@haibun/storage-fs/storage-fs-stepper.js";
import InstanceStepper from "@haibun/cli/instance-stepper.js";
import MonitorStepper from "./monitor-stepper.js";
import GraphSourceStepper from "./graph-source-stepper.js";
import ShuStepper from "./shu-stepper.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";

/**
 * Tests live federation over real RPC, as web-server-hono's rpc-dispatch.test.ts does. The first case's world serves the
 * web server and federates to its own endpoint. That case has one instance and runs the complete mechanism. The
 * handshake, the site-principal collision, the naming call over RPC, the adoption, the registration and the merged stamped
 * read all run against a real HTTP server. Scope "own" keeps the cycle from recursing. The second case federates a
 * separate instance that a haibun step starts.
 */
let captured: TClusteredQuads | undefined;
let adoptedDuringRun: string | undefined;
function resetCaptures(): void {
	captured = undefined;
	adoptedDuringRun = undefined;
}

class FederationVerifyStepper extends AStepper {
	description = "Captures a clustered read federated from another instance for the federation test.";
	steps = {
		captureFederatedRead: {
			description: TEST_STEP,
			gwta: "capture the federated clustered read",
			action: async () => {
				const world = this.getWorld();
				adoptedDuringRun = activeSitePrincipal(world);
				captured = await world.shared.getStore().getClusteredQuads({ perTypeLimit: 10, accessLevel: "private" });
				return OK;
			},
		},
	};
}

describe("federate graph reads over live RPC", () => {
	it("handshakes with the peer, requests a name from it on a site-principal collision and merges the peer's own reads with every subject site-stamped", async () => {
		const port = 8246;
		const world = getTestWorldWithOptions({
			...DEF_PROTO_OPTIONS,
			moduleOptions: { [getStepperOptionName(WebServerStepper, "PORT")]: String(port), [getStepperOptionName(WebServerStepper, "RPC")]: "true" },
		});
		const feature = {
			path: "/features/federate-graph-reads.feature",
			content: `
webserver is listening for "federate-reads"
present authority as "reader"
accept authority from "reader" for "Authority:name,Read:private"
federate graph reads from "http://localhost:${port}"
capture the federated clustered read
`,
		};
		const result = await testWithWorld(
			world,
			[feature],
			[
				WebServerStepper,
				ShuStepper,
				MonitorStepper,
				GraphSourceStepper,
				AuthorityStepper,
				FakeAuthorityStepper,
				ResourcesStepper,
				StorageFS,
				FederationVerifyStepper,
				LogicStepper,
			],
		);
		if (!result.ok) throw new Error(JSON.stringify({ failure: result.failure, steps: result.featureResults?.map((f) => f.stepResults.map((s) => [s.in, s.ok])) }, null, 2));

		// Both ends booted as did:site:0. The connecting side requested a name from the peer over RPC and adopted the returned name.
		expect(adoptedDuringRun).toBe("did:site:0.1");
		// The naming side persisted the assignment as a Principal individual.
		const store = world.shared.getStore();
		expect((await recordOf(store, PRINCIPAL_LABEL, "did:site:0.1"))?.controller).toBe("did:site:0.1");
		// The merged read returned without recursion. It holds the peer's subjects. Each subject is stamped with its serving site.
		const principals = captured?.clusters.find((c) => c.type === PRINCIPAL_LABEL);
		expect(principals?.sampledSubjects.length).toBeGreaterThan(0);
		for (const s of principals?.sampledSubjects ?? []) expect(principals?.sites?.[s]).toBe("did:site:0.1");
	});

	it("federates a separate instance that a haibun step starts without a site collision and stamps each peer subject with the peer's site", { timeout: 60_000 }, async () => {
		resetCaptures();
		const port = 8248;
		const peerPort = 8249;
		const world = getTestWorldWithOptions({
			...DEF_PROTO_OPTIONS,
			moduleOptions: { [getStepperOptionName(WebServerStepper, "PORT")]: String(port), [getStepperOptionName(WebServerStepper, "RPC")]: "true" },
		});
		const feature = {
			path: "/features/federate-two-instances.feature",
			content: `
webserver is listening for "federate-two"
present authority as "reader"
start a haibun instance from "modules/shu/tests/federate-peer" on port ${peerPort} as host 7
federate graph reads from "http://localhost:${peerPort}"
capture the federated clustered read
`,
		};
		const result = await testWithWorld(
			world,
			[feature],
			[
				WebServerStepper,
				ShuStepper,
				MonitorStepper,
				GraphSourceStepper,
				AuthorityStepper,
				FakeAuthorityStepper,
				ResourcesStepper,
				StorageFS,
				InstanceStepper,
				FederationVerifyStepper,
				LogicStepper,
			],
		);
		if (!result.ok) throw new Error(JSON.stringify({ failure: result.failure, steps: result.featureResults?.map((f) => f.stepResults.map((s) => [s.in, s.ok])) }, null, 2));

		// Distinct hostIds give distinct site principals, so the sites don't collide. This instance doesn't adopt an identity and stays did:site:0.
		expect(adoptedDuringRun).toBe("did:site:0");
		// The peer's serve feature runs `name a connecting site`. That step persists did:site:7 and did:site:7.1. The merged view
		// holds those Principals. Each subject is stamped with the serving site. Group-by-site separates subjects by that stamp.
		const principals = captured?.clusters.find((c) => c.type === PRINCIPAL_LABEL);
		expect(principals?.sampledSubjects).toContain("did:site:7");
		expect(principals?.sampledSubjects).toContain("did:site:7.1");
		for (const s of principals?.sampledSubjects ?? []) expect(principals?.sites?.[s]).toBe("did:site:7");
	});
});
