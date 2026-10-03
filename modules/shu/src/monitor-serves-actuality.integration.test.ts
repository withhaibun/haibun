import { describe, expect, it } from "vitest";
import { getTestWorldWithOptions, testWithWorld, DEF_PROTO_OPTIONS } from "@haibun/core/lib/test/lib.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { OK } from "@haibun/core/schema/protocol.js";
import { findStepper, getStepperOptionName } from "@haibun/core/lib/util/index.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { artifactAddress } from "@haibun/core/lib/run-artifact.js";
import { RpcClient } from "@haibun/core/lib/rpc-client.js";
import { localOrigin } from "@haibun/core/lib/local-origin.js";
import { Access, SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { executionOf } from "@haibun/core/lib/seq-path.js";
import type { TClusteredQuads } from "@haibun/core/lib/quad-types.js";
import Haibun from "@haibun/core/steps/haibun.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import ResourcesStepper from "@haibun/core/steps/resources-stepper.js";
import WebServerStepper from "@haibun/web-server-hono/web-server-stepper.js";
import StorageFS from "@haibun/storage-fs/storage-fs.js";
import MonitorStepper, { MONITOR_PATH } from "./monitor-stepper.js";
import GraphSourceStepper from "./graph-source-stepper.js";
import ShuStepper from "./shu-stepper.js";
import { RPC_METHOD } from "./consts.js";
import { ARTIFACT_POLICY } from "./content-security-policy.js";

const PORT = 8254;
const MONITOR = localOrigin(PORT);

/** What the monitor answered while the second feature ran: its page, and the records it read. */
let page: { status: number; body: string } | undefined;
let read: TClusteredQuads | undefined;
/** The policy an HTML artifact a step saved is served with, read by its address. */
let artifactPolicy: string | null | undefined;

class ReadsTheMonitorStepper extends AStepper {
	description = "Reads the monitor's page and the records it serves, as a reader's browser does.";
	private steppers: AStepper[] = [];
	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}
	steps = {
		readTheMonitor: {
			gwta: "read the monitor",
			action: async () => {
				const response = await fetch(`${MONITOR}${MONITOR_PATH}`);
				page = { status: response.status, body: await response.text() };
				const reader = new RpcClient({ baseUrl: MONITOR, timeoutMs: 5_000, retry: { maxAttempts: 1 } });
				read = await reader.call<TClusteredQuads>(RPC_METHOD.CLUSTERED_QUADS, { perTypeLimit: 100, accessLevel: Access.private }, []);
				const saved = await findStepper<StorageFS>(this.steppers, "StorageFS").saveArtifact("saved.html", "<script>document.title = 'ran'</script>");
				artifactPolicy = (await fetch(`${MONITOR}${artifactAddress(saved.baseRelativePath)}`)).headers.get("Content-Security-Policy");
				return OK;
			},
		},
	};
}

describe("the monitor serves the shu views of actuality on its own port", () => {
	it("serves the app and actuality's records from before the first feature to its end, and stops serving when it ends", { timeout: 60_000 }, async () => {
		const world = getTestWorldWithOptions({
			...DEF_PROTO_OPTIONS,
			moduleOptions: { [getStepperOptionName(MonitorStepper, "PORT")]: String(PORT), [getStepperOptionName(WebServerStepper, "ALLOW_WITHOUT_DELEGATION")]: "*" },
		});
		const features = [
			{ path: "/features/a.feature", content: 'Feature: The first feature\nset first to "one"' },
			{ path: "/features/b.feature", content: "Feature: The second feature\nread the monitor" },
		];
		const result = await testWithWorld(world, features, [
			Haibun,
			VariablesStepper,
			ResourcesStepper,
			WebServerStepper,
			ShuStepper,
			MonitorStepper,
			GraphSourceStepper,
			StorageFS,
			ReadsTheMonitorStepper,
		]);
		expect(result.ok, JSON.stringify(result.failure)).toBe(true);

		expect(page?.status).toBe(200);
		expect(page?.body).toContain(world.runtime.actualityId);
		// The monitor's server started before the first feature and outlasts it: the second feature's reader reaches it, and
		// reads that feature's steps through it.
		const steps = read?.quads.filter((quad) => quad.namedGraph === SEQ_PATH_LABEL).map((quad) => String(quad.subject)) ?? [];
		expect(steps.some((id) => id.startsWith(`${executionOf({ ...world.tag, featureNum: 2 })}.`))).toBe(true);

		// An artifact opened by its address runs no script here, as one in a frame of the page doesn't.
		expect(artifactPolicy).toBe(ARTIFACT_POLICY);

		await expect(fetch(`${MONITOR}${MONITOR_PATH}`)).rejects.toThrow();
	});
});
