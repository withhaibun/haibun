// @vitest-environment jsdom
/** Regression: a failing open() RPC must flip loading off and render the error banner. */
import { requiredActionOf } from "../controllers/registry-controller.js";
import { describe, it, expect, beforeEach } from "vitest";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { installServedConduit } from "../root.js";
import { installCarriedEventStream } from "../root.js";
import { rpcAnswer, HANDSHAKE_PATH } from "@haibun/core/lib/test/rpc-answer.js";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { ENTITY_STEP_LIST, serveThePage, newPage } from "../../test/setup.js";

describe("shu-entity-column error surfacing", () => {
	beforeEach(() => {
		newPage();
		document.body.innerHTML = "";
		// LiveConduit honours the stubbed `fetch` below; CarriedEventStream replaces actuality's stream, which this case doesn't follow.
		installServedConduit("", requiredActionOf);
		serveThePage();
		installCarriedEventStream();
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
		// 422 + {error} mirrors a server actionNotOK response.
		globalThis.fetch = (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
			if (url.endsWith(HANDSHAKE_PATH)) return Promise.resolve(rpcAnswer({ seqPath: [0, -1, 1] }, 200));
			if (url.endsWith(`/rpc/${SHOW_STEPS_METHOD}`)) return Promise.resolve(rpcAnswer(ENTITY_STEP_LIST, 200));
			if (url.includes("getIndividualWithEdges")) {
				return Promise.resolve(rpcAnswer({ error: "Issuer not found: did:example:pookie" }, 422));
			}
			return Promise.resolve(rpcAnswer({}, 200));
		};
	});

	it("surfaces the server's 'not found' error in the entity column instead of leaving it spinning", async () => {
		const el = new ShuEntityColumn();
		document.body.appendChild(el);
		await el.open("did:example:pookie", "Issuer");
		await el.updateComplete;
		const refusal = el.shadowRoot?.querySelector("shu-refusal");
		await (refusal as (Element & { updateComplete?: Promise<unknown> }) | null)?.updateComplete;
		expect(refusal?.shadowRoot?.textContent, "the site's refusal, through the refusal view").toContain("Issuer not found: did:example:pookie");
		expect(el.shadowRoot?.innerHTML ?? "").not.toMatch(/Fetching .* did:example:pookie/);
	});

	it("renders the remedy the site's refusal carries as its control", async () => {
		const answering = globalThis.fetch;
		globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			if (url.includes("getIndividualWithEdges"))
				return Promise.resolve(rpcAnswer({ error: "sign in to read the issuer", remedy: { do: "sign-in", at: "https://example.org/sign-in" } }, 401));
			return answering(input, init);
		};
		const el = new ShuEntityColumn();
		document.body.appendChild(el);
		await el.open("did:example:pookie", "Issuer");
		await el.updateComplete;
		const refusal = el.shadowRoot?.querySelector("shu-refusal");
		await (refusal as (Element & { updateComplete?: Promise<unknown> }) | null)?.updateComplete;
		expect(refusal?.shadowRoot?.querySelector('a[href="https://example.org/sign-in"]')?.textContent).toBe("Sign in");
	});
});
