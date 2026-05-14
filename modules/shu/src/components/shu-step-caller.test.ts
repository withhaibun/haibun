// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { StepCaller } from "./shu-step-caller.js";

/**
 * Step-caller form rendering and submit-time input assembly. Two behaviours
 * pinned here:
 *   1. Composite-domain inputs (z.object schemas) render one HTML input per
 *      sub-field, not one stringified-JSON textbox. The user types
 *      `did=did:example:1` and `name=Alice`, not `{"did":"…","name":"…"}`.
 *   2. When a non-composite step input is declared as object/array and the
 *      user types invalid JSON, the submit handler surfaces the parse error
 *      in the form state instead of escaping as an uncaught promise
 *      rejection (the original crash this test was added for).
 */

describe("shu-step-caller", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		if (!customElements.get("shu-step-caller")) customElements.define("shu-step-caller", StepCaller);
	});

	function makeCaller(descriptor: Record<string, unknown>): HTMLElement {
		const el = document.createElement("shu-step-caller") as HTMLElement & { descriptor?: Record<string, unknown> };
		(el as { descriptor: Record<string, unknown> }).descriptor = descriptor;
		document.body.appendChild(el);
		return el;
	}

	it("renders one input per sub-field for a composite-domain parameter (instead of a single stringified-JSON input)", () => {
		const descriptor = {
			method: "IssueStepper-createIssuer",
			pattern: "create issuer {issuer: issuer}",
			inputSchema: {
				properties: {
					issuer: {
						type: "object",
						properties: { did: { type: "string" }, name: { type: "string" } },
						required: ["did"],
					},
				},
				required: ["issuer"],
			},
		};
		const caller = makeCaller(descriptor);
		// Force render by setting the attribute the step uses; mounting alone doesn't render
		// the form, since the descriptor is normally resolved via findStep on connect.
		caller.setAttribute("step", "IssueStepper-createIssuer");
		// Drive render manually via the public refresh path most components expose; the
		// step-caller renders on render() so we exercise it via its dispatched property.
		(caller as unknown as { renderComponent: () => void }).renderComponent?.();
		const html = caller.shadowRoot?.innerHTML ?? "";
		expect(html).toContain('name="issuer.did"');
		expect(html).toContain('name="issuer.name"');
		// And NO single JSON-blob input for the composite itself.
		expect(html).not.toMatch(/name="issuer"[^.]/);
	});

	it("setting `call-index` before appendChild yields a testid with the index baked in (regression: live SPA was emitting testids without the index)", () => {
		const descriptor = {
			method: "IssueStepper-createIssuer",
			pattern: "create issuer {issuer: issuer}",
			inputSchema: {
				properties: { issuer: { type: "object", properties: { did: { type: "string" } }, required: ["did"] } },
				required: ["issuer"],
			},
		};
		const caller = document.createElement("shu-step-caller") as HTMLElement & { descriptor?: Record<string, unknown> };
		caller.setAttribute("step", "createIssuer");
		caller.setAttribute("call-index", "0");
		(caller as { descriptor: Record<string, unknown> }).descriptor = descriptor;
		document.body.appendChild(caller);
		// Force a render path that runs after descriptor + attributes are set.
		(caller as unknown as { renderComponent: () => void }).renderComponent?.();
		const html = caller.shadowRoot?.innerHTML ?? "";
		expect(html).toContain('data-testid="createIssuer-0-step-input-issuer-did"');
	});

	it("composite-input testids use `-` (not `.`) so haibun variable resolution doesn't parse them as dot-paths", () => {
		const descriptor = {
			method: "IssueStepper-createIssuer",
			pattern: "create issuer {issuer: issuer}",
			inputSchema: {
				properties: {
					issuer: {
						type: "object",
						properties: { did: { type: "string" }, name: { type: "string" } },
						required: ["did"],
					},
				},
				required: ["issuer"],
			},
		};
		const caller = makeCaller(descriptor);
		caller.setAttribute("step", "IssueStepper-createIssuer");
		caller.setAttribute("call-index", "0");
		(caller as unknown as { renderComponent: () => void }).renderComponent?.();
		const html = caller.shadowRoot?.innerHTML ?? "";
		// testids are unique per invocation: `<stepName>-<callIndex>-step-input-<paramName>-<subField>`.
		expect(html).toContain('data-testid="IssueStepper-createIssuer-0-step-input-issuer-did"');
		expect(html).toContain('data-testid="IssueStepper-createIssuer-0-step-input-issuer-name"');
		expect(html).toContain('name="issuer.did"');
		expect(html).toContain('name="issuer.name"');
	});

	it("invalid JSON in an object-typed input surfaces as a form error, not an uncaught promise rejection", async () => {
		const descriptor = {
			method: "Test-take",
			pattern: "take {payload}",
			inputSchema: { properties: { payload: { type: "object" } }, required: ["payload"] },
		};
		const caller = makeCaller(descriptor) as HTMLElement & { callStep: (v: Record<string, string>) => Promise<void>; error: string };
		caller.setAttribute("step", "Test-take");
		(caller as unknown as { renderComponent: () => void }).renderComponent?.();
		// Inject the invalid value through the same code path the form submit handler uses.
		// The original crash was `JSON.parse("aaaa")` thrown synchronously before the inner try/catch.
		let rejected = false;
		try {
			await caller.callStep({ payload: "aaaa" });
		} catch {
			rejected = true;
		}
		expect(rejected).toBe(false);
		expect(caller.error).toMatch(/invalid input/i);
	});

	it("server-side validation errors (HTTP 200 body with `error`) render in the step-error div, not a silent step-result", async () => {
		// Pattern: dispatchStep returns actionNotOK, web-server returns
		// `{ error: "<method>: <message>" }` body with HTTP 200 — so the
		// SSE client throws and the step-caller catches. The error div
		// must include the server message verbatim so the user sees what
		// the schema rejected. This pins the contract.
		const descriptor = {
			method: "IssueStepper-issueCredential",
			pattern: "issue credential {credential}",
			inputSchema: { properties: { credential: { type: "object" } }, required: ["credential"] },
		};
		// jsdom doesn't ship an EventSource — stub one so the shared SseSubscriber
		// constructor (called lazily by SseClient.for) doesn't throw before fetch
		// can be intercepted.
		(globalThis as { EventSource?: unknown }).EventSource = class StubEventSource {
			addEventListener(): void {
				/* stub — no real SSE in jsdom */
			}
			removeEventListener(): void {
				/* stub */
			}
			close(): void {
				/* stub */
			}
		};
		// jsdom also leaves scrollIntoView unset on HTMLElement; stub it so the
		// post-render scroll call in callStep doesn't crash the test.
		if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = (): void => undefined;
		const realFetch = globalThis.fetch;
		// The web-server-stepper returns HTTP 422 for action results carrying
		// an `error` field, mirroring the SPA's wire contract. The SSE client
		// throws on either non-OK status or `data.error`, so callStep's catch
		// branch fires regardless of which trigger the runtime sees first.
		globalThis.fetch = (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
			if (url.endsWith("/rpc/session.beginAction")) return Promise.resolve(new Response(JSON.stringify({ seqPath: [0, -1, 1] }), { status: 200, headers: { "Content-Type": "application/json" } }));
			if (url.endsWith("/rpc/IssueStepper-issueCredential")) {
				return Promise.resolve(
					new Response(JSON.stringify({ error: 'IssueStepper-issueCredential: "type" must include `VerifiableCredential`.' }), {
						status: 422,
						headers: { "Content-Type": "application/json" },
					}),
				);
			}
			return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }));
		};
		try {
			const caller = makeCaller(descriptor) as HTMLElement & { callStep: (v: Record<string, string>) => Promise<void>; error: string };
			caller.setAttribute("step", "IssueStepper-issueCredential");
			(caller as unknown as { renderComponent: () => void }).renderComponent?.();
			await caller.callStep({ credential: JSON.stringify({ type: ["bogus"] }) });
			expect(caller.error).toContain('"type" must include');
			expect(caller.error).toContain("VerifiableCredential");
			const html = caller.shadowRoot?.innerHTML ?? "";
			expect(html).toMatch(/class="error"[^>]*data-testid="[^"]*-step-error"/);
			expect(html).toContain('"type" must include');
			// Loading indicator must be cleared on error — the user-reported
			// regression was the step-caller stuck on "loading..." indefinitely
			// after server-side validation rejected the input.
			expect(html).not.toMatch(/class="loading"/);
		} finally {
			globalThis.fetch = realFetch;
			delete (globalThis as { EventSource?: unknown }).EventSource;
		}
	});

	it("oversized-response errors (HTTP 413 with `error`) render in the step-error div instead of hanging the caller", async () => {
		// When a step's products exceed V8's max-string length, the web-server
		// can't JSON.stringify them. It returns HTTP 413 with a structured
		// `error` so the client gets a definite failure instead of an aborted
		// response that strands the caller in "loading…" forever.
		const descriptor = {
			method: "GraphStepper-graphQuery",
			pattern: "graph query {query}",
			inputSchema: { properties: { query: { type: "object" } }, required: ["query"] },
		};
		(globalThis as { EventSource?: unknown }).EventSource = class StubEventSource {
			addEventListener(): void {
				/* stub — no real SSE in jsdom */
			}
			removeEventListener(): void {
				/* stub */
			}
			close(): void {
				/* stub */
			}
		};
		if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = (): void => undefined;
		const realFetch = globalThis.fetch;
		globalThis.fetch = (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
			if (url.endsWith("/rpc/session.beginAction")) return Promise.resolve(new Response(JSON.stringify({ seqPath: [0, -1, 1] }), { status: 200, headers: { "Content-Type": "application/json" } }));
			if (url.endsWith("/rpc/GraphStepper-graphQuery")) {
				return Promise.resolve(
					new Response(JSON.stringify({ ok: false, error: "GraphStepper-graphQuery: response too large to serialize (Invalid string length). Narrow the query or return a summary." }), {
						status: 413,
						headers: { "Content-Type": "application/json" },
					}),
				);
			}
			return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }));
		};
		try {
			const caller = makeCaller(descriptor) as HTMLElement & { callStep: (v: Record<string, string>) => Promise<void>; error: string };
			caller.setAttribute("step", "GraphStepper-graphQuery");
			(caller as unknown as { renderComponent: () => void }).renderComponent?.();
			await caller.callStep({ query: JSON.stringify({ all: true }) });
			expect(caller.error).toContain("response too large");
			const html = caller.shadowRoot?.innerHTML ?? "";
			expect(html).toMatch(/class="error"[^>]*data-testid="[^"]*-step-error"/);
			expect(html).toContain("response too large");
			expect(html).not.toMatch(/class="loading"/);
		} finally {
			globalThis.fetch = realFetch;
			delete (globalThis as { EventSource?: unknown }).EventSource;
		}
	});
});
