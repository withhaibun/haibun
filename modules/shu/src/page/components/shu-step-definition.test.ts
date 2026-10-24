// @vitest-environment jsdom
/**
 * A step's view states the step as actuality declares it: its line, the domain of each argument and of what it returns,
 * each a link to the domain's view, the view of the type it persists as where it persists, and the step is chosen in the
 * actions bar from here. A step actuality declares and the page may not call states its line, the action it requires, and
 * the action the page lacks, each linked; a method actuality doesn't declare is refused with the method named.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHOW_STEP_DEFINITIONS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { StepMethodSchema } from "@haibun/core/lib/steps/domains/step-method.js";
import { ActionSchema } from "@haibun/core/lib/domains/actions.js";
import { REF_DENOTES } from "@haibun/core/lib/domains/typed-links.js";
import { ShuStepDefinition } from "./shu-step-definition.js";
import "./shu-ref-element.js";

import { setupShuTest, stepsShown, type TShuTestHandle } from "../../test/setup.js";
import { installMemoryDeviceStore } from "../client-cache/root.js";
import { SHU_EVENT } from "../../domains/elements.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { endPage } from "../adapters/page-held.js";

const IDS = SHU_TEST_IDS.STEP_DEFINITION;
const [CREDENTIAL, CREDENTIAL_TYPE, CHECK] = ["credential", "VerifiableCredential", "verification"];
const VERIFY = {
	method: "VerifierStepper-verify",
	stepperName: "VerifierStepper",
	stepName: "verify",
	pattern: "verify {credential}",
	paramDomains: { credential: CREDENTIAL },
	productsDomain: CHECK,
};
const STATEMENT_PARAM = "what";
const [TYPE_PARAM, RECORD_ID] = ["label", "record-id"];
const READ = {
	method: "GraphStepper-getRelated",
	stepperName: "GraphStepper",
	stepName: "getRelated",
	pattern: `get related for {${TYPE_PARAM}} {id}`,
	paramDomains: { [TYPE_PARAM]: "persisted-type", id: RECORD_ID },
	recordIds: { id: TYPE_PARAM },
};
const SUSPEND = {
	method: "CredentialsStepper-suspendCredential",
	stepperName: "CredentialsStepper",
	stepName: "suspendCredential",
	pattern: "suspend credential {id}",
	description: "Suspends a credential",
	callable: false,
};
const SUSPENDING = ActionSchema.parse("CredentialsStepper:suspendCredential");
const HOLDING = {
	method: "AuthorityStepper-holdingOnly",
	stepperName: "AuthorityStepper",
	stepName: "holdingOnly",
	pattern: `holding only {actions}, {${STATEMENT_PARAM}: statement}`,
	paramDomains: { actions: "string", [STATEMENT_PARAM]: "statement" },
	productsOf: STATEMENT_PARAM,
};

describe("a step's view", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		endPage();
		installMemoryDeviceStore();
		handle = setupShuTest({
			dispatch: (method) => {
				if (method === SHOW_STEP_DEFINITIONS_METHOD) return stepsShown([VERIFY, HOLDING, READ, SUSPEND], { [CREDENTIAL]: { persistedAs: CREDENTIAL_TYPE }, [CHECK]: {} });
				throw new Error(`unexpected ${method}`);
			},
		});
	});
	afterEach(() => {
		handle.teardown();
		document.body.innerHTML = "";
	});

	const opened = async (method: string) => {
		const view = document.body.appendChild(new ShuStepDefinition());
		await view.open(StepMethodSchema.parse(method));
		await view.updateComplete;
		return view;
	};
	const refsAt = (view: ShuStepDefinition, testId: string) =>
		[...(view.shadowRoot?.querySelectorAll(`[data-testid="${testId}"] shu-ref`) ?? [])].map((ref) => ({
			kind: ref.getAttribute("kind"),
			target: JSON.parse(ref.getAttribute("linkTarget") ?? "{}"),
			text: ref.textContent,
		}));

	it("states its line and links each domain it takes and returns to the domain's view", async () => {
		const view = await opened(VERIFY.method);
		expect(view.shadowRoot?.querySelector(`[data-testid="${IDS.PATTERN}"]`)?.textContent).toBe(VERIFY.pattern);
		expect(refsAt(view, IDS.PARAM)).toEqual([{ kind: REF_DENOTES.type, target: { domain: CREDENTIAL_TYPE }, text: CREDENTIAL }]);
		expect(refsAt(view, IDS.PRODUCTS)).toEqual([{ kind: REF_DENOTES.type, target: { domain: CHECK }, text: CHECK }]);
	});

	it("states the type a record id's step names it by", async () => {
		const view = await opened(READ.method);
		const params = [...(view.shadowRoot?.querySelectorAll(`[data-testid="${IDS.PARAM}"]`) ?? [])].map((dd) => dd.textContent?.replace(/\s+/g, " ").trim());
		expect(params).toContain(`${RECORD_ID} of the type {${TYPE_PARAM}} names`);
	});

	it("states that a step passing on what its statement returns returns that", async () => {
		const view = await opened(HOLDING.method);
		expect(view.shadowRoot?.querySelector(`[data-testid="${IDS.PRODUCTS}"]`)?.textContent).toBe(`what its {${STATEMENT_PARAM}} returns`);
	});

	it("chooses the step in the actions bar", async () => {
		const view = await opened(VERIFY.method);
		const chosen: unknown[] = [];
		document.addEventListener(SHU_EVENT.STEP_CHOOSE, (e) => chosen.push((e as CustomEvent).detail), { once: true });
		const choose = view.shadowRoot?.querySelector<HTMLButtonElement>(`[data-testid="${IDS.CHOOSE}"]`);
		expect(choose).toBeTruthy();
		choose?.click();
		expect(chosen).toEqual([{ method: VERIFY.method }]);
	});

	it("states a step this page can't call: its line, the action it requires and the action the page lacks, each linked, and doesn't offer to choose it", async () => {
		const view = await opened(SUSPEND.method);
		expect(view.shadowRoot?.querySelector(`[data-testid="${IDS.PATTERN}"]`)?.textContent).toBe(SUSPEND.pattern);
		expect(refsAt(view, IDS.LACKS)).toEqual([{ kind: "action", target: { action: SUSPENDING }, text: SUSPENDING }]);
		expect(view.shadowRoot?.querySelector(`[data-testid="${IDS.CHOOSE}"]`)).toBeNull();
		expect(view.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.ACTION_COLUMN.HOLDS}"]`)?.textContent).toContain("doesn't hold");
	});

	it("refuses a method actuality doesn't declare, naming it", async () => {
		const view = await opened("VerifierStepper-nothing");
		const refusal = view.shadowRoot?.querySelector<HTMLElement & { updateComplete: Promise<boolean> }>("shu-refusal");
		await refusal?.updateComplete;
		expect(refusal?.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.REFUSAL.CAUSE}"]`)?.textContent).toContain("actuality doesn't declare VerifierStepper-nothing");
	});
});
