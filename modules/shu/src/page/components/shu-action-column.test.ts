// @vitest-environment jsdom
/**
 * An action's view lists the steps this page may call that the action allows, by the reading every gate on a call uses:
 * the steps requiring it, reads at a narrower level for a read, and every step whose action a trailing `*` begins. An action
 * that doesn't allow one of them links the steps actuality declares that it allows, and the view states who holds the action here.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHOW_STEP_DEFINITIONS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { ActionSchema, readAction } from "@haibun/core/lib/domains/actions.js";
import { Access } from "@haibun/core/lib/domains/resources.js";
import { ShuActionColumn } from "./shu-action-column.js";
import "./shu-ref-element.js";

import { openReportingPage, setupShuTest, stepsShown, type TShuTestHandle } from "../../test/setup.js";
import { installMemoryDeviceStore } from "../client-cache/root.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { endPage } from "../adapters/page-held.js";

const IDS = SHU_TEST_IDS.ACTION_COLUMN;
const DELEGATE = "Authority:delegate";
const [PUBLIC_READ, PRIVATE_READ, DELEGATES, REVOKES] = [
	{ method: "GraphStepper-graphQuery", stepperName: "GraphStepper", stepName: "graphQuery", pattern: "query {label}", read: true, capability: readAction(Access.public) },
	{ method: "GraphStepper-getPrivate", stepperName: "GraphStepper", stepName: "getPrivate", pattern: "get private {id}", read: true, capability: readAction(Access.private) },
	{ method: "DelegationStepper-delegate", stepperName: "DelegationStepper", stepName: "delegate", pattern: "delegate {actions}", capability: DELEGATE },
	{ method: "DelegationStepper-revoke", stepperName: "DelegationStepper", stepName: "revoke", pattern: "revoke {capability}", capability: "Authority:revoke" },
];

const SUSPENDS = ActionSchema.parse("AccountStepper:suspendAccount");
const SUSPEND = { method: "AccountStepper-suspendAccount", stepperName: "AccountStepper", stepName: "suspendAccount", pattern: "suspend account {id}", callable: false };
const DELEGATION = { id: "urn:uuid:delegation-1", persistedAs: "Delegation" };

describe("an action's view", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		endPage();
		installMemoryDeviceStore();
		handle = setupShuTest({
			dispatch: (method) => {
				if (method === SHOW_STEP_DEFINITIONS_METHOD) return stepsShown([PUBLIC_READ, PRIVATE_READ, DELEGATES, REVOKES, SUSPEND]);
				throw new Error(`unexpected ${method}`);
			},
		});
	});
	afterEach(() => {
		handle.teardown();
		document.body.innerHTML = "";
	});

	const opened = async (action: string) => {
		const view = document.body.appendChild(new ShuActionColumn());
		await view.open(ActionSchema.parse(action));
		await view.updateComplete;
		return view;
	};
	const linked = (view: ShuActionColumn, testId: string, field: string) =>
		[...(view.shadowRoot?.querySelectorAll(`[data-testid="${testId}"]`) ?? [])].flatMap((at) =>
			[...(at.matches("shu-ref") ? [at] : at.querySelectorAll("shu-ref"))].map((ref) => JSON.parse(ref.getAttribute("linkTarget") ?? "{}")[field]),
		);
	const allows = async (action: string) => linked(await opened(action), IDS.STEP, "method");

	it("links each step the action allows, each read at a narrower level, and each step a trailing * begins", async () => {
		expect(await allows(DELEGATE)).toEqual([DELEGATES.method]);
		expect(await allows(readAction(Access.private)), "a private read allows a public one").toEqual([PUBLIC_READ.method, PRIVATE_READ.method]);
		expect(await allows(readAction(Access.public))).toEqual([PUBLIC_READ.method]);
		expect(await allows("Authority:*")).toEqual([DELEGATES.method, REVOKES.method]);
		expect(await allows("Nothing:here")).toEqual([]);
	});

	it("links each step actuality declares that an action allows where it doesn't allow a step this page may call, and states that the page doesn't hold it", async () => {
		const view = await opened(SUSPENDS);
		expect(linked(view, IDS.REQUIRER, "method")).toEqual([SUSPEND.method]);
		expect(linked(view, IDS.HOLDS, "action")).toEqual([SUSPENDS]);
		expect(view.shadowRoot?.querySelector(`[data-testid="${IDS.HOLDS}"]`)?.textContent).toContain("doesn't hold");
	});

	it("links the delegation of an action this page holds", async () => {
		await openReportingPage(async () => ({
			delegations: [{ id: DELEGATION.id, allowedAction: [DELEGATE, readAction(Access.public)] }],
			records: { [DELEGATION.id]: { persistedAs: DELEGATION.persistedAs, accessLevel: Access.public } },
		}));
		const view = await opened(DELEGATE);
		expect(linked(view, IDS.HOLDS, "id")).toContain(DELEGATION.id);
		expect(view.shadowRoot?.querySelector(`[data-testid="${IDS.HOLDS}"]`)?.textContent).toContain("holds");
	});
});
