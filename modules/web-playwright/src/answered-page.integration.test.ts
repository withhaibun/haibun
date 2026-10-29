import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";

import { AStepper } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK, getStepperOptionName } from "@haibun/core/lib/domains/util.js";
import { failWithDefaults } from "@haibun/core/lib/test/lib.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import { DEFAULT_DEST, type TStepResult } from "@haibun/core/lib/domains/protocol.js";
import { validatedFeatureStep } from "@haibun/core/lib/call-step.js";
import { runRegistry } from "@haibun/core/lib/step-registry.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { dispatchStep } from "@haibun/core/lib/step-dispatch.js";
import { answeredFor } from "@haibun/core/lib/call-step.js";
import { allocateSyntheticSeqPath } from "@haibun/core/lib/domains/host-id.js";
import StorageMem from "@haibun/storage-mem/storage-mem-stepper.js";
import WebPlaywright from "./web-playwright-stepper.js";
import { BrowserFactory } from "./adapters/browser-factory.js";
import { READS_THE_PAGE } from "./domains/actions.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";

afterAll(async () => {
	await BrowserFactory.closeBrowsers();
});

const moduleOptions = { [getStepperOptionName(WebPlaywright, "STORAGE")]: "StorageMem", [getStepperOptionName(WebPlaywright, "HEADLESS")]: "true" };
const PRESSED = "pressed";
const CALLS_THE_PAGE = "handing out the page's snapshot and its button's reference to a caller";
/** A reference an AI-mode snapshot names. */
const REFERENCE = /\[ref=(e\d+)\]/;
const answered: { clicked?: TStepResult; asked?: TStepResult } = {};

/** Calls WebPlaywright's steps by name, as a model's tool call does, and reads their results as the turn does. */
class CallerProbe extends AStepper {
	description = "Calls WebPlaywright's steps by name, as a model's tool call does.";
	steps = {
		callsThePage: {
			description: TEST_STEP,
			gwta: CALLS_THE_PAGE,
			action: async () => {
				const world = this.getWorld();
				const ctx = { registry: runRegistry(world), world, steppers: world.runtime.steppers ?? [] };
				const call = async (step: string, input: Record<string, unknown>) => {
					const tool = ctx.registry.named(stepMethodName(WebPlaywright.name, step));
					const seqPath = allocateSyntheticSeqPath(world);
					return { tool, result: await dispatchStep(ctx, validatedFeatureStep(tool, input, seqPath, world, ctx.steppers)) };
				};
				const read = await call(READS_THE_PAGE, {});
				const ref = String(read.result.products?.snapshot).match(new RegExp(`button "Press" ${REFERENCE.source}`))?.[1];
				if (!ref) return actionNotOK(`the snapshot doesn't name the button's reference: ${String(read.result.products?.snapshot)}`);
				const click = await call("clickBy", { target: ref, method: "reference" });
				answered.asked = click.result;
				answered.clicked = await answeredFor(ctx, click.tool, click.result);
				return actionOK();
			},
		},
	};
}

describe("an action a model calls", () => {
	it("returns the page it left, whose snapshot names the reference a click takes, and a step dispatched alone returns without it", { timeout: 20_000 }, async () => {
		const server = createServer((_request, response) => response.end(`<title>a page</title><button onclick="document.title='${PRESSED}'">Press</button>`));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;
		const content = [`go to the "http://127.0.0.1:${port}/" webpage`, CALLS_THE_PAGE].join("\n");
		try {
			const res = await failWithDefaults([{ path: "/features/caller.feature", content }], [WebPlaywright, CallerProbe, StorageMem, LogicStepper], {
				options: { DEST: DEFAULT_DEST },
				moduleOptions,
			});
			expect(res.ok, JSON.stringify(res.failure ?? res.featureResults?.[0]?.stepResults.filter((step) => !step.ok)).slice(0, 600)).toBe(true);
			expect(answered.asked?.ok, "the click passes").toBe(true);
			expect(answered.asked?.products, "and its step returns without reading the page").toBeUndefined();
			expect(answered.clicked?.products?.title, "a caller receives the page it left").toBe(PRESSED);
			expect(String(answered.clicked?.products?.snapshot), "a snapshot of it").toMatch(REFERENCE);
		} finally {
			server.close();
		}
	});
});
