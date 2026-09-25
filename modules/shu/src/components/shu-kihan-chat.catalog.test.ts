// @vitest-environment jsdom
/**
 * The models the ask pane offers follow the run: a pane opened before the run had models says it has none, and offers
 * the ones the run records after, as discovery writes them.
 */
import { describe, expect, it, vi } from "vitest";
import type { TDriven } from "./chat-pane.test-fake.js";

vi.mock("../rpc-registry.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), ...(await import("./chat-pane.test-fake.js")).rpcRegistry }));
vi.mock("../rels-cache.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), getActionBarChatExtensionTags: () => [] }));
vi.mock("../chat-context-harvest.js", () => ({ harvestChatViewLd: () => [] }));
/** The models the run holds, which a read of the catalog lists. */
let models: Array<{ id: string; displayName: string }> = [];
vi.mock("../hypermedia.js", async () => {
	const { hypermedia } = await import("./chat-pane.test-fake.js");
	return hypermedia(
		(req) => (req.method === "showKihans" ? { vertices: models, total: models.length } : req.method === "listChatSessions" ? { sessions: [] } : {}),
		() => Promise.resolve(),
	);
});

const { SerializedEventStream, setEventStream } = await import("../event-stream.js");
const { ShuCombobox } = await import("./shu-combobox.js");
const { ShuKihanChat } = await import("./shu-kihan-chat.js");
const { SHU_ATTR } = await import("../consts.js");
if (!customElements.get("shu-combobox")) customElements.define("shu-combobox", ShuCombobox);

const KIHAN = "Kihan";
const MODEL = { id: "openai:a-model", displayName: "a model" };
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("the models the ask pane offers", () => {
	it("are none where the run has none, and the ones the run records after the pane opened", async () => {
		const stream = new SerializedEventStream();
		setEventStream(stream);
		const pane = new ShuKihanChat() as unknown as TDriven;
		pane.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
		document.body.appendChild(pane);
		await flush();
		await pane.updateComplete;
		expect(pane.shadowRoot?.querySelector('[data-testid$="no-models"]')?.textContent).toBe("No models in this run.");
		expect(pane.shadowRoot?.querySelector(".model-select")).toBeNull();

		models = [MODEL];
		stream.emit({ kind: "artifact", artifactType: "json", json: { quadObservation: { subject: MODEL.id, predicate: "name", object: MODEL.displayName, namedGraph: KIHAN } } } as never);
		await flush();
		await pane.updateComplete;
		expect(pane.shadowRoot?.querySelector('[data-testid$="no-models"]')).toBeNull();
		expect(pane.shadowRoot?.querySelector(".model-select"), "the model the run recorded is offered").not.toBeNull();
	});
});
