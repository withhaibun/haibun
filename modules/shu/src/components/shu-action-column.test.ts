// @vitest-environment jsdom
/**
 * An action's view lists the steps this page may call that the action allows, by the reading every gate on a call uses:
 * the steps requiring it, reads at a narrower level for a read, and every step whose action a trailing `*` begins.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { readAction } from "@haibun/core/lib/actions.js";
import { Access } from "@haibun/core/lib/resources.js";
import { ShuActionColumn } from "./shu-action-column.js";
import { ShuRef } from "./shu-ref-element.js";
import { resetStepRegistry } from "../rpc-registry.js";
import { setupShuTest, stepsShown, type TShuTestHandle } from "../test-setup.js";
import { setDeviceStore, MemoryDeviceStore } from "../client-cache/index.js";
import { SHU_TAG } from "../consts.js";
import { SHU_TEST_IDS } from "../test-ids.js";

const IDS = SHU_TEST_IDS.ACTION_COLUMN;
const DELEGATE = "Authority:delegate";
const [PUBLIC_READ, PRIVATE_READ, DELEGATES, REVOKES] = [
	{ method: "GraphStepper-graphQuery", stepperName: "GraphStepper", stepName: "graphQuery", pattern: "query {label}", read: true, capability: readAction(Access.public) },
	{ method: "GraphStepper-getPrivate", stepperName: "GraphStepper", stepName: "getPrivate", pattern: "get private {id}", read: true, capability: readAction(Access.private) },
	{ method: "DelegationStepper-delegate", stepperName: "DelegationStepper", stepName: "delegate", pattern: "delegate {actions}", capability: DELEGATE },
	{ method: "DelegationStepper-revoke", stepperName: "DelegationStepper", stepName: "revoke", pattern: "revoke {capability}", capability: "Authority:revoke" },
];

describe("an action's view", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		resetStepRegistry();
		setDeviceStore(new MemoryDeviceStore());
		handle = setupShuTest({ dispatch: (method) => (method === SHOW_STEPS_METHOD ? stepsShown([PUBLIC_READ, PRIVATE_READ, DELEGATES, REVOKES]) : undefined) });
		for (const [tag, element] of [
			[SHU_TAG.ACTION_COLUMN, ShuActionColumn],
			[SHU_TAG.REF, ShuRef],
		] as const)
			if (!customElements.get(tag)) customElements.define(tag, element);
	});
	afterEach(() => {
		handle.teardown();
		resetStepRegistry();
		document.body.innerHTML = "";
	});

	const allows = async (action: string) => {
		const view = document.body.appendChild(new ShuActionColumn());
		await view.open(action);
		await view.updateComplete;
		return [...(view.shadowRoot?.querySelectorAll(`shu-ref[data-testid="${IDS.STEP}"]`) ?? [])].map((ref) => JSON.parse(ref.getAttribute("linkTarget") ?? "{}").method);
	};

	it("links each step the action allows, each read at a narrower level, and each step a trailing * begins", async () => {
		expect(await allows(DELEGATE)).toEqual([DELEGATES.method]);
		expect(await allows(readAction(Access.private)), "a private read allows a public one").toEqual([PUBLIC_READ.method, PRIVATE_READ.method]);
		expect(await allows(readAction(Access.public))).toEqual([PUBLIC_READ.method]);
		expect(await allows("Authority:*")).toEqual([DELEGATES.method, REVOKES.method]);
		expect(await allows("Nothing:here")).toEqual([]);
	});
});
