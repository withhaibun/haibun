// @vitest-environment jsdom
/**
 * A page open on actuality reads actuality's steps again when actuality adds to them: actuality signals the change on its
 * stream, and the page reads its steps again over RPC. Actuality adds steps while a page is open when it starts another host.
 */
import { requiredActionOf } from "../controllers/registry-controller.js";
import { SSE_ROUTE } from "@haibun/core/lib/rpc-wire.js";
import { describe, it } from "vitest";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { actionOK, getStepperOptionName } from "@haibun/core/lib/domains/util.js";
import { DEF_PROTO_OPTIONS, freePort, getTestWorldWithOptions, testWithWorld } from "@haibun/core/lib/test/lib.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import { hostScopedMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { runRegistry } from "@haibun/core/lib/step-registry.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import WebServerStepper from "@haibun/web-server-hono/web-server-stepper.js";
import StorageFS from "@haibun/storage-fs/storage-fs-stepper.js";
import MonitorStepper from "../../monitor-stepper.js";
import ShuStepper from "../../shu-stepper.js";
import { installServedConduit } from "../root.js";

import { installServedEventStream, pageEventStream } from "../root.js";
import { getAvailableSteps, onStepsChanged } from "../controllers/registry-controller.js";
import { serveThePageFrom } from "../../test/setup.js";
import { DOMAIN_LINK } from "@haibun/core/lib/domains/domains.js";
import { endPage } from "../adapters/page-held.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";

/** The step another host adds, named as actuality names that host's steps. */
const ADDED = hostScopedMethodName(9, "Haibun-validateStep");

/** Resolves once the page holds the added step. */
let holdsAdded: Promise<void> | undefined;

class StepsPage extends AStepper {
	description = "Opens a page on the actuality that follows actuality's steps, adds a step as a transport does, and checks what the page holds.";
	steps = {
		opens: {
			description: TEST_STEP,
			gwta: `page at {base: ${DOMAIN_LINK}} reads actuality's steps`,
			action: async ({ base }: { base: string }) => {
				endPage();
				await serveThePageFrom(base);
				installServedConduit(base, requiredActionOf);
				installServedEventStream(`${base}${SSE_ROUTE}`);
				// The stream is open before the page reads, so the page reads its steps once and then once for the change.
				await new Promise<void>((resolve) => {
					const stop = pageEventStream().opened(() => {
						resolve();
						queueMicrotask(stop);
					});
					pageEventStream().connect();
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
			description: TEST_STEP,
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
			description: TEST_STEP,
			gwta: "page holds the added step",
			action: async () => {
				if (!holdsAdded) throw new Error("a page doesn't follow actuality's steps: a scenario opens one with `page at {base} reads actuality's steps` first");
				await holdsAdded;
				pageEventStream().close();
				endPage();
				return actionOK();
			},
		},
	};
}

describe("a page open on a run", () => {
	it("holds a step actuality adds while it is open, read again when actuality signals its steps changed", { timeout: 60_000 }, async () => {
		const port = await freePort();
		const base = `http://localhost:${port}`;
		const world = getTestWorldWithOptions({
			...DEF_PROTO_OPTIONS,
			// This actuality doesn't verify a delegation, so the deployment allows every action without one, as haibun alone does.
			moduleOptions: {
				...DEF_PROTO_OPTIONS.moduleOptions,
				[getStepperOptionName(WebServerStepper, "PORT")]: String(port),
				[getStepperOptionName(WebServerStepper, "ALLOW_WITHOUT_DELEGATION")]: "*",
				[getStepperOptionName(WebServerStepper, "RPC")]: "true",
			},
		});
		const feature = {
			path: "/features/rpc-registry-following.feature",
			content: `webserver is listening for "a page following actuality's steps"\npage at "${base}" reads actuality's steps\nrun adds another host's step\npage holds the added step\n`,
		};
		const result = await testWithWorld(world, [feature], [WebServerStepper, ShuStepper, MonitorStepper, StorageFS, Haibun, StepsPage, LogicStepper]);
		if (!result.ok)
			throw new Error(JSON.stringify({ failure: result.failure, steps: result.featureResults?.map((f) => f.stepResults.filter((s) => !s.ok).map((s) => [s.in, s.errorMessage])) }));
	});
});
