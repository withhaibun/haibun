// @vitest-environment jsdom
/**
 * A step's view states the step as the run declares it: its line, the domain of each argument and of what it returns,
 * each a link to the domain's view, the view of the type it persists as where it persists. A method that isn't among the
 * steps the page may call is refused with the method named, and the step is chosen in the actions bar from here.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { REF_DENOTES } from "@haibun/core/lib/typed-links.js";
import { ShuStepDefinition } from "./shu-step-definition.js";
import { ShuRef } from "./shu-ref-element.js";
import { resetStepRegistry } from "../rpc-registry.js";
import { setupShuTest, stepsShown, type TShuTestHandle } from "../test-setup.js";
import { setDeviceStore, MemoryDeviceStore } from "../client-cache/index.js";
import { SHU_EVENT, SHU_TAG } from "../consts.js";
import { SHU_TEST_IDS } from "../test-ids.js";

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
		resetStepRegistry();
		setDeviceStore(new MemoryDeviceStore());
		handle = setupShuTest({
			dispatch: (method) => (method === SHOW_STEPS_METHOD ? stepsShown([VERIFY, HOLDING, READ], { [CREDENTIAL]: { persistedAs: CREDENTIAL_TYPE }, [CHECK]: {} }) : undefined),
		});
		for (const [tag, element] of [
			[SHU_TAG.STEP_DEFINITION, ShuStepDefinition],
			[SHU_TAG.REF, ShuRef],
		] as const)
			if (!customElements.get(tag)) customElements.define(tag, element);
	});
	afterEach(() => {
		handle.teardown();
		resetStepRegistry();
		document.body.innerHTML = "";
	});

	const opened = async (method: string) => {
		const view = document.body.appendChild(new ShuStepDefinition());
		await view.open(method);
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

	it("refuses a method that isn't among the steps this page may call, naming it", async () => {
		const view = await opened("VerifierStepper-nothing");
		expect(view.shadowRoot?.querySelector(`[data-testid="${IDS.ERROR}"]`)?.textContent).toBe("VerifierStepper-nothing is not among the steps this page may call");
	});
});
