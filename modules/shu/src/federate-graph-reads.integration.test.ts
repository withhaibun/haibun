import { describe, expect, it } from "vitest";
import { getTestWorldWithOptions, testWithWorld, DEF_PROTO_OPTIONS } from "@haibun/core/lib/test/lib.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { OK } from "@haibun/core/schema/protocol.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { activeSitePrincipal } from "@haibun/core/lib/host-id.js";
import { PRINCIPAL_LABEL, type TPrincipal } from "@haibun/core/lib/resources.js";
import type { TClusteredQuads } from "@haibun/core/lib/quad-types.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import ResourcesStepper from "@haibun/core/steps/resources-stepper.js";
import WebServerStepper from "@haibun/web-server-hono/web-server-stepper.js";
import StorageFS from "@haibun/storage-fs/storage-fs.js";
import InstanceStepper from "@haibun/cli/instance-stepper.js";
import MonitorStepper from "./monitor-stepper.js";
import ShuStepper from "./shu-stepper.js";

/**
 * Live federation over real RPC, in the rpc-dispatch.test pattern: one world serves the web server and
 * federates to its own endpoint. Degenerate as a topology, complete as a mechanism — the handshake, the
 * site-principal collision, the naming call over the wire, the adoption, the registration, and the merged
 * stamped read all run against a real HTTP server; scope "own" is what keeps the cycle from recursing.
 */
let captured: TClusteredQuads | undefined;
let adoptedDuringRun: string | undefined;
function resetCaptures(): void {
	captured = undefined;
	adoptedDuringRun = undefined;
}

class FederationVerifyStepper extends AStepper {
	steps = {
		captureFederatedRead: {
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
	it("handshakes, de-collides by asking the peer for a name, and merges the peer's own reads with every subject site-stamped", async () => {
		const port = 8246;
		const world = getTestWorldWithOptions({ ...DEF_PROTO_OPTIONS, moduleOptions: { [getStepperOptionName(WebServerStepper, "PORT")]: String(port) } });
		const feature = {
			path: "/features/federate-graph-reads.feature",
			content: `
enable rpc
webserver is listening for "federate-reads"
federate graph reads from "http://localhost:${port}"
capture the federated clustered read
`,
		};
		const result = await testWithWorld(world, [feature], [WebServerStepper, ShuStepper, MonitorStepper, AuthorityStepper, ResourcesStepper, StorageFS, FederationVerifyStepper]);
		if (!result.ok) throw new Error(JSON.stringify({ failure: result.failure, steps: result.featureResults?.map((f) => f.stepResults.map((s) => [s.in, s.ok])) }, null, 2));

		// Both ends booted as did:site:0 — the connecting side asked the peer (over the wire) what it should be called and adopted the answer.
		expect(adoptedDuringRun).toBe("did:site:0.1");
		// The namer durably recorded the assignment as a Principal individual.
		const store = world.shared.getStore();
		expect((await store.getIndividual<TPrincipal>(PRINCIPAL_LABEL, "did:site:0.1"))?.controller).toBe("did:site:0.1");
		// The merged view came back (no recursion) with the peer's subjects present and EVERY one stamped with its serving site.
		const principals = captured?.clusters.find((c) => c.type === PRINCIPAL_LABEL);
		expect(principals?.sampledSubjects.length).toBeGreaterThan(0);
		for (const s of principals?.sampledSubjects ?? []) expect(principals?.sites?.[s]).toBe("did:site:0.1");
	});

	it(
		"federates a genuinely separate instance — started the haibun way — and the merged view carries BOTH sites",
		{ timeout: 60_000 },
		async () => {
			resetCaptures();
			const port = 8248;
			const peerPort = 8249;
			const world = getTestWorldWithOptions({ ...DEF_PROTO_OPTIONS, moduleOptions: { [getStepperOptionName(WebServerStepper, "PORT")]: String(port) } });
			const feature = {
				path: "/features/federate-two-instances.feature",
				content: `
enable rpc
webserver is listening for "federate-two"
start a haibun instance from "modules/shu/tests/federate-peer" on port ${peerPort} as host 7
federate graph reads from "http://localhost:${peerPort}"
capture the federated clustered read
`,
			};
			const result = await testWithWorld(world, [feature], [WebServerStepper, ShuStepper, MonitorStepper, AuthorityStepper, ResourcesStepper, StorageFS, InstanceStepper, FederationVerifyStepper]);
			if (!result.ok) throw new Error(JSON.stringify({ failure: result.failure, steps: result.featureResults?.map((f) => f.stepResults.map((s) => [s.in, s.ok])) }, null, 2));

			// Distinct hostIds → distinct site principals → no collision, nothing adopted: this instance stays did:site:0.
			expect(adoptedDuringRun).toBe("did:site:0");
			// The peer's own Principals (its serve feature ran `name a connecting site`, persisting did:site:7 + did:site:7.1)
			// arrive in the merged view, every subject stamped with the SERVING site — the data group-by-site separates on.
			const principals = captured?.clusters.find((c) => c.type === PRINCIPAL_LABEL);
			expect(principals?.sampledSubjects).toContain("did:site:7");
			expect(principals?.sampledSubjects).toContain("did:site:7.1");
			for (const s of principals?.sampledSubjects ?? []) expect(principals?.sites?.[s]).toBe("did:site:7");
		},
	);
});
