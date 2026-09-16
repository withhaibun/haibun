// @vitest-environment jsdom
/** Regression: a failing open() RPC must flip loading off and render the error banner. */
import { describe, it, expect, beforeEach } from "vitest";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { setConduit, LiveConduit, resetConduit } from "../hypermedia.js";
import { setEventStream, SerializedEventStream, resetEventStream } from "../event-stream.js";
import { rpcAnswer } from "@haibun/core/lib/test/rpc-answer.js";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/steps-query.js";
import { ENTITY_STEP_LIST } from "../test-setup.js";

describe("shu-entity-column error surfacing", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		resetConduit();
		resetEventStream();
		// LiveConduit honours the stubbed `fetch` below; SerializedEventStream replaces the SSE source so the component's `eventStream()` call doesn't reach for an EventSource that jsdom doesn't ship.
		setConduit(new LiveConduit(""));
		setEventStream(new SerializedEventStream());
		if (!customElements.get("shu-entity-column")) customElements.define("shu-entity-column", ShuEntityColumn);
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
		// 422 + {error} mirrors a server actionNotOK response.
		globalThis.fetch = (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
			if (url.endsWith("/rpc/action.begin")) return Promise.resolve(rpcAnswer({ seqPath: [0, -1, 1] }, 200));
			if (url.endsWith(`/rpc/${SHOW_STEPS_METHOD}`)) return Promise.resolve(rpcAnswer(ENTITY_STEP_LIST, 200));
			if (url.includes("getIndividualWithEdges")) {
				return Promise.resolve(rpcAnswer({ error: "Issuer not found: did:example:pookie" }, 422));
			}
			return Promise.resolve(rpcAnswer({}, 200));
		};
		// jsdom lacks EventSource; stub so SseClient.for("") doesn't throw.
		(globalThis as { EventSource?: unknown }).EventSource = class StubEventSource {
			addEventListener(): void {
				/* stub */
			}
			removeEventListener(): void {
				/* stub */
			}
			close(): void {
				/* stub */
			}
		};
	});

	it("surfaces the server's 'not found' error in the entity column instead of leaving it spinning", async () => {
		const el = document.createElement("shu-entity-column") as ShuEntityColumn;
		document.body.appendChild(el);
		await el.open("did:example:pookie", "Issuer");
		await el.updateComplete;
		const html = el.shadowRoot?.innerHTML ?? "";
		expect(html).toContain("Issuer not found: did:example:pookie");
		expect(html).not.toMatch(/Fetching .* did:example:pookie/);
	});
});
