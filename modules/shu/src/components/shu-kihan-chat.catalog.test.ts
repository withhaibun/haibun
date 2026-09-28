// @vitest-environment jsdom
/**
 * The models the ask pane offers follow the run: a pane opened before the run had models says it doesn't have one, and offers
 * the ones the run records after, as discovery writes them.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { CHAT_STEP, chatDispatch, type TDriven } from "./chat-pane.test-fake.js";
import { persistedTypeDefinition, setupShuTest, type TShuTestHandle } from "../test-setup.js";
import "./shu-combobox.js";
import { ShuKihanChat } from "./shu-kihan-chat.js";
import { SHU_ATTR } from "../consts.js";

/** The models the run holds, which a read of the catalog lists. */
let models: Array<{ id: string; displayName: string }> = [];
/** The type the run's models are grouped under, the records of it discovery wrote, and the step that lists them. */
const PROVIDER = "ModelProvider";
let providers: Array<{ id: string; answered: boolean; models: number; why?: string }> = [];
const PROVIDERS_STEP = `show${PROVIDER}s`;
/** The type the run's models are records of, each grouped under the provider it is called through. */
const KIHAN = "Kihan";
const GROUPED = LinkRelations.CONTEXT.rel;
const MODELS_BY_PROVIDER = buildConcernCatalog(
	mapDefinitionsToDomains([
		persistedTypeDefinition(KIHAN, { properties: { provider: GROUPED }, edges: { provider: { range: PROVIDER, rel: GROUPED } } }),
		persistedTypeDefinition(PROVIDER),
	]),
);

let t: TShuTestHandle;
beforeEach(() => {
	const listing = (vertices: unknown[]) => ({ vertices, total: vertices.length });
	const respond = (step: string) =>
		step === CHAT_STEP.catalog ? listing(models) : step === PROVIDERS_STEP ? listing(providers) : step === CHAT_STEP.sessions ? { sessions: [] } : {};
	t = setupShuTest({ dispatch: chatDispatch(respond, { steps: [...Object.values(CHAT_STEP), PROVIDERS_STEP], concerns: MODELS_BY_PROVIDER }) });
});
afterEach(() => t.teardown());

const MODEL = { id: "openai:a-model", displayName: "a model" };
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("the models the ask pane offers", () => {
	it("don't include a model where the run doesn't have one, and are the ones the run records after the pane opened", async () => {
		const pane = new ShuKihanChat() as unknown as TDriven;
		pane.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
		document.body.appendChild(pane);
		await flush();
		await pane.updateComplete;
		expect(pane.shadowRoot?.querySelector('[data-testid$="no-models"]')?.textContent).toBe("This run doesn't hold a model.");
		expect(pane.shadowRoot?.querySelector(".model-select")).toBeNull();

		models = [MODEL];
		t.emit({
			kind: "artifact",
			artifactType: "json",
			json: { quadObservation: { subject: MODEL.id, predicate: "name", object: MODEL.displayName, namedGraph: KIHAN } },
		});
		await flush();
		await pane.updateComplete;
		expect(pane.shadowRoot?.querySelector('[data-testid$="no-models"]')).toBeNull();
		expect(pane.shadowRoot?.querySelector(".model-select"), "the model the run recorded is offered").not.toBeNull();
	});
});

describe("the providers the ask pane lists", () => {
	it("names each provider that doesn't have a model registered in the run, linked to its record, with why", async () => {
		models = [MODEL];
		providers = [
			{ id: "openai", answered: true, models: 1 },
			{ id: "gemini", answered: false, models: 0, why: "it refused the key" },
		];
		const pane = new ShuKihanChat() as unknown as TDriven;
		pane.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
		document.body.appendChild(pane);
		await flush();
		await pane.updateComplete;
		const listed = pane.shadowRoot?.querySelector('[data-testid$="providers-without"]');
		expect(listed?.textContent).toContain("did not answer discovery: it refused the key");
		expect(JSON.parse(listed?.querySelector("shu-ref")?.getAttribute("linkTarget") ?? "{}")).toEqual({ persistedAs: PROVIDER, id: "gemini" });
	});
});
