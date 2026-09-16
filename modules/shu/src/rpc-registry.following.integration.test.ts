// @vitest-environment jsdom
/**
 * A page open on a run reads the run's steps again when the run adds to them: the run signals the change on its stream,
 * and the page reads its steps again over RPC. A run adds steps while a page is open when it stands up another host.
 */
import { EventSource } from "eventsource";
import { describe, it } from "vitest";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { actionOK, getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { DEF_PROTO_OPTIONS, freePort, getTestWorldWithOptions, testWithWorld } from "@haibun/core/lib/test/lib.js";
import { hostScopedMethodName, runRegistry } from "@haibun/core/lib/step-registry.js";
import Haibun from "@haibun/core/steps/haibun.js";
import WebServerStepper from "@haibun/web-server-hono/web-server-stepper.js";
import StorageFS from "@haibun/storage-fs/storage-fs.js";
import MonitorStepper from "./monitor-stepper.js";
import ShuStepper from "./shu-stepper.js";
import { LiveConduit, setConduit } from "./hypermedia.js";
import { LiveEventStream, eventStream, setEventStream } from "./event-stream.js";
import { getAvailableSteps, onStepsChanged, resetStepRegistry } from "./rpc-registry.js";

globalThis.EventSource = EventSource as unknown as typeof globalThis.EventSource;

/** The step another host would add, named as this run names that host's steps. */
const ADDED = hostScopedMethodName(9, "Haibun-validateStep");

/** Resolves once the page holds the added step. */
let holdsAdded: Promise<void> | undefined;

class StepsPage extends AStepper {
	description = "Opens a page on the run that follows the run's steps, adds a step as a transport does, and checks what the page holds.";
	steps = {
		opens: {
			gwta: "page at {base} reads the run's steps",
			action: async ({ base }: { base: string }) => {
				resetStepRegistry();
				setConduit(new LiveConduit(base));
				setEventStream(new LiveEventStream(`${base}/sse`));
				// The stream is open before the page reads, so the page reads its steps once and then once for the change.
				await new Promise<void>((resolve) => {
					const stop = eventStream().opened(() => {
						resolve();
						queueMicrotask(stop);
					});
				});
				const methods = (await getAvailableSteps()).map((step) => step.method);
				if (methods.includes(ADDED)) throw new Error(`${ADDED} was held before it was added`);
				holdsAdded = new Promise((resolve) => {
					onStepsChanged(async () => {
						if ((await getAvailableSteps()).some((step) => step.method === ADDED)) resolve();
					});
				});
				return actionOK();
			},
		},
		adds: {
			gwta: "run adds another host's step",
			action: () => {
				const registry = runRegistry(this.getWorld());
				const validates = registry.get("Haibun-validateStep");
				if (!validates) throw new Error("Haibun-validateStep is not registered");
				registry.inject([{ ...validates, descriptor: { ...validates.descriptor, method: ADDED } }]);
				return Promise.resolve(actionOK());
			},
		},
		holds: {
			gwta: "page holds the added step",
			action: async () => {
				if (!holdsAdded) throw new Error("no page follows the run's steps: a scenario opens one with `page at {base} reads the run's steps` first");
				await holdsAdded;
				resetStepRegistry();
				eventStream().close();
				return actionOK();
			},
		},
	};
}

describe("a page open on a run", () => {
	it("holds a step the run adds while it is open, read again when the run signals its steps changed", { timeout: 60_000 }, async () => {
		const port = await freePort();
		const base = `http://localhost:${port}`;
		const world = getTestWorldWithOptions({
			...DEF_PROTO_OPTIONS,
			moduleOptions: { ...DEF_PROTO_OPTIONS.moduleOptions, [getStepperOptionName(WebServerStepper, "PORT")]: String(port) },
		});
		const feature = {
			path: "/features/rpc-registry-following.feature",
			content: `enable rpc\nwebserver is listening for "a page following the run's steps"\npage at "${base}" reads the run's steps\nrun adds another host's step\npage holds the added step\n`,
		};
		const result = await testWithWorld(world, [feature], [WebServerStepper, ShuStepper, MonitorStepper, StorageFS, Haibun, StepsPage]);
		if (!result.ok)
			throw new Error(JSON.stringify({ failure: result.failure, steps: result.featureResults?.map((f) => f.stepResults.filter((s) => !s.ok).map((s) => [s.in, s.errorMessage])) }));
	});
});
