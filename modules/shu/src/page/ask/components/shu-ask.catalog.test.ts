// @vitest-environment jsdom
/**
 * The models the ask pane offers follow actuality: a pane opened before actuality had models reports it doesn't have one, and offers
 * the ones actuality records after, as discovery writes them.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { CONVERSATION_MODEL_CLASS } from "@haibun/core/lib/conversation/domains/conversation.js";
import { buildConcernCatalog, counted } from "@haibun/core/lib/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { CHAT_STEP, chatDispatch, type TDriven } from "./chat-pane.test-fake.js";
import { persistedTypeDefinition, setupShuTest, type TShuTestHandle } from "../../../test/setup.js";
import "../../components/shu-combobox.js";
import { ShuAsk } from "./shu-ask.js";
import { SHU_ATTR } from "../../../domains/elements.js";

/** The models actuality holds, which a read of the catalog lists. */
let models: Array<{ id: string; displayName: string }> = [];
/** The type actuality's models are grouped under, and the records of it discovery wrote. */
const PROVIDER = "ModelProvider";
let providers: Array<{ id: string; answered: boolean; models: number; why?: string }> = [];
/** The type whose records are actuality's models, each grouped under the provider that serves it. */
const MODELS = "AskingModel";
const GROUPED = LinkRelations.CONTEXT.rel;
const MODELS_BY_PROVIDER = buildConcernCatalog(
	mapDefinitionsToDomains([
		persistedTypeDefinition(MODELS, { properties: { provider: GROUPED }, edges: { provider: { range: PROVIDER, rel: GROUPED } }, subClassOf: CONVERSATION_MODEL_CLASS }),
		persistedTypeDefinition(PROVIDER),
	]),
);

let t: TShuTestHandle;
beforeEach(() => {
	const listing = (vertices: unknown[]) => ({ vertices, ...counted(vertices.length) });
	// The read of a type returns the records of the type its query names: the models, or their providers.
	const ofType = (params: Record<string, unknown>) => ((params.query as { label?: string } | undefined)?.label === MODELS ? models : providers);
	const respond = (step: string, params: Record<string, unknown>) =>
		step === CHAT_STEP.catalog ? listing(ofType(params)) : step === CHAT_STEP.sessions ? { sessions: [], ...counted(0) } : {};
	t = setupShuTest({ dispatch: chatDispatch(respond, { concerns: MODELS_BY_PROVIDER }) });
});
afterEach(() => t.teardown());

const MODEL = { id: "openai:a-model", displayName: "a model" };
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("the models the ask pane offers", () => {
	it("don't include a model where actuality doesn't have one, and are the ones actuality records after the pane opened", async () => {
		const pane = new ShuAsk() as unknown as TDriven;
		pane.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
		document.body.appendChild(pane);
		await flush();
		await pane.updateComplete;
		expect(pane.shadowRoot?.querySelector('[data-testid$="no-models"]')?.textContent).toBe("Actuality doesn't hold a model.");
		expect(pane.shadowRoot?.querySelector(".model-select")).toBeNull();

		models = [MODEL];
		t.emit({ kind: "artifact", artifactType: "json", json: { quadObservation: { subject: MODEL.id, predicate: "name", object: MODEL.displayName, namedGraph: MODELS, timestamp: 1 } } });
		await flush();
		await pane.updateComplete;
		expect(pane.shadowRoot?.querySelector('[data-testid$="no-models"]')).toBeNull();
		expect(pane.shadowRoot?.querySelector(".model-select"), "the model actuality recorded is offered").not.toBeNull();
	});
});

describe("the providers the ask pane lists", () => {
	it("names each provider that doesn't have a model registered in actuality, linked to its record, with why", async () => {
		models = [MODEL];
		providers = [
			{ id: "openai", answered: true, models: 1 },
			{ id: "gemini", answered: false, models: 0, why: "it refused the key" },
		];
		const pane = new ShuAsk() as unknown as TDriven;
		pane.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
		document.body.appendChild(pane);
		await flush();
		await pane.updateComplete;
		const listed = pane.shadowRoot?.querySelector('[data-testid$="providers-without"]');
		expect(listed?.textContent).toContain("did not respond to discovery: it refused the key");
		expect(JSON.parse(listed?.querySelector("shu-ref")?.getAttribute("linkTarget") ?? "{}")).toEqual({ persistedAs: PROVIDER, id: "gemini" });
	});
});
