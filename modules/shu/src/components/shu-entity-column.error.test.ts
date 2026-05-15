// @vitest-environment jsdom
/**
 * Regression: when the entity-column's open() RPC fails (e.g. "Issuer not found"),
 * the pane must transition out of `loading` and surface the error in its banner.
 * Before this fix, an erroring fetch left `loading: true` because the catch branch
 * never set state (or the error path was missed in audit).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ShuEntityColumn } from "./shu-entity-column.js";

describe("shu-entity-column error surfacing", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		if (!customElements.get("shu-entity-column")) customElements.define("shu-entity-column", ShuEntityColumn);
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
		// Stub fetch for the session.beginAction RPC + the actual getVertexWithEdges RPC.
		// The 422 response simulates a server-side actionNotOK for "Issuer not found".
		globalThis.fetch = (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
			if (url.endsWith("/rpc/session.beginAction")) return Promise.resolve(new Response(JSON.stringify({ seqPath: [0, -1, 1] }), { status: 200, headers: { "Content-Type": "application/json" } }));
			if (url.includes("step.list"))
				return Promise.resolve(
					new Response(
						JSON.stringify({
							steps: [
								{
									method: "GraphStepper-getVertexWithEdges",
									stepperName: "GraphStepper",
									stepName: "getVertexWithEdges",
									pattern: "get vertex {label} {id}",
									params: {},
								},
							],
							domains: {},
							concerns: { vertices: {}, references: {} },
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					),
				);
			if (url.includes("getVertexWithEdges")) {
				return Promise.resolve(
					new Response(JSON.stringify({ error: "Issuer not found: did:example:pookie" }), {
						status: 422,
						headers: { "Content-Type": "application/json" },
					}),
				);
			}
			return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }));
		};
		// jsdom doesn't ship EventSource; stub one so SseClient.for("") doesn't throw.
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
		const html = el.shadowRoot?.innerHTML ?? "";
		expect(html).toContain("Issuer not found: did:example:pookie");
		expect(html).not.toMatch(/Fetching .* did:example:pookie/);
	});
});
