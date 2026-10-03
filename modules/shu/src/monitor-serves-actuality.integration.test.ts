import { describe, expect, it } from "vitest";
import { getTestWorldWithOptions, testWithWorld, DEF_PROTO_OPTIONS } from "@haibun/core/lib/test/lib.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { OK } from "@haibun/core/schema/protocol.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { RPC_ROUTE, rpcEnvelope } from "@haibun/core/lib/rpc-wire.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
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

const PORT = 8254;
const MONITOR = `http://localhost:${PORT}`;
const CLUSTERED = "GraphSourceStepper-getClusteredQuads";

/** What the monitor answered while the second feature ran: its page, and the records it read. */
let page: { status: number; body: string } | undefined;
let read: TClusteredQuads | undefined;

class ReadsTheMonitorStepper extends AStepper {
	description = "Reads the monitor's page and the records it serves, as a reader's browser does.";
	steps = {
		readTheMonitor: {
			gwta: "read the monitor",
			action: async () => {
				const response = await fetch(`${MONITOR}${MONITOR_PATH}`);
				page = { status: response.status, body: await response.text() };
				const body = rpcEnvelope({
					id: "monitor-read",
					method: CLUSTERED,
					params: { perTypeLimit: 100, accessLevel: "private" },
					actualityId: this.getWorld().runtime.actualityId,
				});
				const answer = await fetch(`${MONITOR}${RPC_ROUTE}${CLUSTERED}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
				read = (await answer.json()) as TClusteredQuads;
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

		await expect(fetch(`${MONITOR}${MONITOR_PATH}`)).rejects.toThrow();
	});
});
