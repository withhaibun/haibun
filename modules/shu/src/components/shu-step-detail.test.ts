// @vitest-environment jsdom
/**
 * shu-step-detail reads one step's record and the quads whose provenance names it, through a @lit/task keyed on the
 * step, so switching steps cancels the stale read and the previous step's data never lingers. The record is read from
 * the graph; the quads come from a stubbed RPC behind LiveConduit.
 */
import { describe, it, expect, beforeEach } from "vitest";
import "./shu-step-detail.js"; // side-effect import so the module runs (registration is via component-registry in the app)
import { ShuStepDetail, stepRecordId } from "./shu-step-detail.js";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { setConduit, LiveConduit, resetConduit } from "../hypermedia.js";
import { setEventStream, SerializedEventStream, resetEventStream } from "../event-stream.js";
import { setGraphStore } from "../quads-snapshot.js";
import { setSiteMetadata, type SiteMetadata } from "../rels-cache.js";
import { noteExecution, resetExecutions } from "../client-cache/index.js";

const EXECUTION = "1700000000000-1";
const json = (body: unknown): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));

describe("shu-step-detail", () => {
	beforeEach(async () => {
		document.body.innerHTML = "";
		resetConduit();
		resetEventStream();
		resetExecutions();
		setConduit(new LiveConduit(""));
		setEventStream(new SerializedEventStream());
		if (!customElements.get("shu-step-detail")) customElements.define("shu-step-detail", ShuStepDetail);
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
		// One step of the execution being read: what it asked for, what ran, how it went and where.
		const store = new QuadStore();
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			id: `${EXECUTION}.0.1`,
			stepText: "a step",
			called: "S.does",
			actionStatus: "passed",
			ranVia: "rpc",
			level: "info",
			generatedAtTime: new Date(1000).toISOString(),
			endedAtTime: new Date(1005).toISOString(),
		});
		setGraphStore(store);
		setSiteMetadata({ types: [SEQ_PATH_LABEL], rels: { [SEQ_PATH_LABEL]: {} }, edgeRanges: {} } as unknown as SiteMetadata);
		noteExecution(EXECUTION);
		globalThis.fetch = (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
			if (url.endsWith("/rpc/action.begin")) return json({ seqPath: [0, -1, 1] });
			if (url.includes("getClusteredQuads"))
				return json({ quads: [{ subject: "myVar", predicate: "set", object: "42", namedGraph: "vars", timestamp: 1, properties: { provenance: [[0, 1]] } }] });
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

	it("renders the step's record and the variables it set", async () => {
		const el = document.createElement("shu-step-detail") as ShuStepDetail;
		document.body.appendChild(el);
		await el.open([0, 1]);
		await el.updateComplete;
		const t = text(el);
		expect(t).toContain("Step [0.1]");
		expect(t, "what ran, and how it went").toContain("S.does");
		expect(t, "where it ran and how long it took, which its record states").toContain("rpc 5ms");
		expect(t).toContain("Data set (1)");
		expect(t).toContain("myVar");
	});

	it("re-keys the read when the step changes, dropping the previous step's data", async () => {
		const el = document.createElement("shu-step-detail") as ShuStepDetail;
		document.body.appendChild(el);
		await el.open([0, 1]);
		await el.updateComplete;
		expect(text(el)).toContain("myVar");
		await el.open([0, 2]); // the page holds no record of this step, and there is no site to ask
		await el.updateComplete;
		const t = text(el);
		expect(t, "a step the page cannot read reports that, rather than claiming there is no such step").toContain("Failed to load step [0.2]");
		expect(t).not.toContain("myVar");
	});

	it("surfaces a failed read instead of spinning forever", async () => {
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

describe("the record that is a step", () => {
	it("is the step's path under the execution being read", () => {
		expect(stepRecordId([0, 1], EXECUTION)).toBe(`${EXECUTION}.0.1`);
	});
	it("is nothing before an execution has been read, or with no step named", () => {
		expect(stepRecordId([0, 1], undefined)).toBeUndefined();
		expect(stepRecordId([], EXECUTION)).toBeUndefined();
	});
});
