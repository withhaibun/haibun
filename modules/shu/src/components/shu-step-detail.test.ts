// @vitest-environment jsdom
/**
 * shu-step-detail drives its trace/quads load through a @lit/task keyed on the seqPath. These tests confirm the loaded
 * state renders the step's trace and the variables it set, and that switching steps re-keys the task so the previous
 * step's data never lingers. RPC is a stubbed fetch behind LiveConduit; the events backfill is the in-memory store.
 */
import { describe, it, expect, beforeEach } from "vitest";
import "./shu-step-detail.js"; // side-effect import so the module runs (registration is via component-registry in the app)
import { ShuStepDetail } from "./shu-step-detail.js";
import { setConduit, LiveConduit, resetConduit } from "../hypermedia.js";
import { setEventStream, SerializedEventStream, resetEventStream } from "../event-stream.js";

const json = (body: unknown): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));

describe("shu-step-detail", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		resetConduit();
		resetEventStream();
		setConduit(new LiveConduit(""));
		setEventStream(new SerializedEventStream());
		if (!customElements.get("shu-step-detail")) customElements.define("shu-step-detail", ShuStepDetail);
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
		globalThis.fetch = (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
			if (url.endsWith("/rpc/action.begin")) return json({ seqPath: [0, -1, 1] }); // conduit().group() opens a batch here
			if (url.includes("getDispatchTraces")) return json({ traces: [{ seqPath: [0, 1], transport: "rpc", durationMs: 5, productKeys: ["p1"] }] });
			if (url.includes("getClusteredQuads")) return json({ quads: [{ subject: "myVar", predicate: "set", object: "42", namedGraph: "vars", timestamp: 1, properties: { provenance: [[0, 1]] } }] });
			return json({});
		};
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

	const text = (el: ShuStepDetail): string => el.shadowRoot?.textContent?.replace(/\s+/g, " ").trim() ?? "";

	it("renders the loaded step's trace and the variables it set", async () => {
		const el = document.createElement("shu-step-detail") as ShuStepDetail;
		document.body.appendChild(el);
		await el.open([0, 1]);
		await el.updateComplete;
		const t = text(el);
		expect(t).toContain("Step [0.1]");
		expect(t).toContain("rpc 5ms"); // trace transport + duration
		expect(t).toContain("Data set (1)");
		expect(t).toContain("myVar");
	});

	it("re-keys the task when the step changes, dropping the previous step's data", async () => {
		const el = document.createElement("shu-step-detail") as ShuStepDetail;
		document.body.appendChild(el);
		await el.open([0, 1]);
		await el.updateComplete;
		expect(text(el)).toContain("myVar");
		await el.open([0, 2]); // no trace and no quad names 0.2
		await el.updateComplete;
		const t = text(el);
		expect(t).toContain("No data found for step [0.2]");
		expect(t).not.toContain("myVar");
	});

	it("surfaces a load failure instead of spinning forever", async () => {
		globalThis.fetch = (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
			if (url.endsWith("/rpc/action.begin")) return json({ seqPath: [0, -1, 1] });
			return Promise.resolve(new Response(JSON.stringify({ error: "boom" }), { status: 422, headers: { "Content-Type": "application/json" } }));
		};
		const el = document.createElement("shu-step-detail") as ShuStepDetail;
		document.body.appendChild(el);
		await el.open([0, 3]);
		await el.updateComplete;
		expect(text(el)).toContain("Failed to load step [0.3]");
	});
});
