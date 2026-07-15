// @vitest-environment jsdom
// The open column must never go stale: it holds its individual through the entity handle, whose store merges live
// observations into the held copy in place; the column re-renders from that copy — no per-change refetch.
// Observations for other subjects are ignored. The store's merge/notify is covered by entity-store.test.ts;
// this exercises only the column's subscribe-and-rerender wiring.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { resetEntityStore } from "../entity-store.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const observation = (subject: string, predicate: string, object: string): Record<string, unknown> => ({
	kind: "artifact",
	artifactType: "json",
	json: { quadObservation: { subject, predicate, object, namedGraph: "Task" } },
});

const STEP_LIST = {
	steps: [
		{ method: "GraphStepper-getIndividualWithEdges", stepperName: "GraphStepper", stepName: "getIndividualWithEdges", pattern: "get vertex {label} {id}", params: {} },
		{ method: "ResourcesStepper-annotations", stepperName: "ResourcesStepper", stepName: "annotations", pattern: "get annotations for {label} {id}", params: {} },
	],
	domains: {},
	concerns: { persisted: {}, references: {} },
};

describe("shu-entity-column live refresh", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		if (!customElements.get("shu-entity-column")) customElements.define("shu-entity-column", ShuEntityColumn);
		handle = setupShuTest({
			dispatch: (method) => {
				if (method === "step.list") return STEP_LIST;
				if (method === "GraphStepper-getIndividualWithEdges") return { vertex: { "@id": "t1", title: "before", note: "x" }, edges: [], incomingCount: 0 };
				if (method === "ResourcesStepper-annotations") return { annotations: [] };
				throw new Error(`unexpected ${method}`);
			},
		});
	});
	afterEach(() => {
		resetEntityStore();
		handle.teardown();
	});

	const openSeeded = async (): Promise<ShuEntityColumn> => {
		const el = document.createElement("shu-entity-column") as ShuEntityColumn;
		document.body.appendChild(el); // onConnected subscribes through the entity handle
		await el.open("t1", "Task");
		await flush();
		return el;
	};

	it("re-renders from the merged copy when an observation arrives for its open subject", async () => {
		const el = await openSeeded();
		expect(el.shadowRoot?.textContent).toContain("before");
		handle.emit(observation("t1", "title", "after"));
		await flush();
		expect(el.shadowRoot?.textContent).toContain("after");
	});

	it("ignores observations for a different subject", async () => {
		const el = await openSeeded();
		handle.emit(observation("other", "title", "after"));
		await flush();
		expect(el.shadowRoot?.textContent).not.toContain("after");
	});
});
