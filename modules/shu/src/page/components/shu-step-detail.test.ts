// @vitest-environment jsdom
/**
 * shu-step-detail reads one step's record and the variables whose records link it, through a @lit/task keyed on the
 * step, so switching steps cancels the stale read and the previous step's data never lingers. The record is read from
 * the graph; the variables' quads come from a stubbed RPC behind LiveConduit.
 */
import { declareGraphSpec } from "../../test/catalog-fixture.js";
import { requiredActionOf } from "../controllers/registry-controller.js";
import { serveThePage, newPage } from "../../test/setup.js";
import { actualityStore } from "../client-cache/actuality-store.test-fake.js";
import { describe, it, expect, beforeEach } from "vitest";
import "./shu-step-detail.js"; // the module defines the element
import { SHU_TAG } from "../../domains/elements.js";
import type { ShuStepDetail } from "./shu-step-detail.js";
import { EDGE, SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SHARED_GRAPH } from "@haibun/core/lib/quad-types.js";
import { VARIABLE_FIELD } from "@haibun/core/lib/records/domains/variables.js";
import { installServedConduit } from "../root.js";
import { installCarriedEventStream } from "../root.js";
import { installGraph, noteExecution } from "../client-cache/controllers/device-controller.js";
import { rpcAnswer, HANDSHAKE_PATH } from "@haibun/core/lib/test/rpc-answer.js";

const EXECUTION = "1700000000000-1";
const STEP = `${EXECUTION}.0.1`;
/** The record of a variable the step set: its value, and its edge to the step's record. */
const SET_BY_STEP = [
	{ subject: "myVar", predicate: VARIABLE_FIELD.value, object: "42", namedGraph: SHARED_GRAPH, timestamp: 1 },
	{ subject: "myVar", predicate: EDGE.wasGeneratedBy, object: STEP, objectType: SEQ_PATH_LABEL, namedGraph: SHARED_GRAPH, timestamp: 1 },
];

describe("shu-step-detail", () => {
	beforeEach(async () => {
		newPage();
		document.body.innerHTML = "";
		installServedConduit("", requiredActionOf);
		serveThePage();
		installCarriedEventStream();
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
		// One step of the execution being read: what it requested, what ran, how it went and where.
		const store = actualityStore();
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			id: STEP,
			stepText: "a step",
			called: "S.does",
			actionStatus: "passed",
			ranVia: "remote",
			level: "info",
			generatedAtTime: new Date(1000).toISOString(),
			endedAtTime: new Date(1005).toISOString(),
		});
		installGraph(store);
		declareGraphSpec({ types: [SEQ_PATH_LABEL], ui: { [SEQ_PATH_LABEL]: { component: SHU_TAG.STEP_DETAIL } } });
		noteExecution(EXECUTION);
		globalThis.fetch = (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
			if (url.endsWith(HANDSHAKE_PATH)) return Promise.resolve(rpcAnswer({ seqPath: [0, -1, 1] }, 200));
			if (url.includes("getClusteredQuads")) return Promise.resolve(rpcAnswer({ quads: SET_BY_STEP }, 200));
			// The page reads the step's record from what it holds, as it does where the site doesn't respond.
			return Promise.reject(new TypeError("the step's record is read from the page"));
		};
	});

	const text = (el: ShuStepDetail): string => el.shadowRoot?.textContent?.replace(/\s+/g, " ").trim() ?? "";
	/** The refusal the view shows, as its own shadow root renders it. */
	const refusalOf = (el: ShuStepDetail): ShadowRoot | null | undefined => el.shadowRoot?.querySelector("shu-refusal")?.shadowRoot;

	it("renders the step's record and the variables it set", async () => {
		const el = document.createElement("shu-step-detail") as ShuStepDetail;
		document.body.appendChild(el);
		await el.open(`${EXECUTION}.0.1`, SEQ_PATH_LABEL);
		await el.updateComplete;
		const t = text(el);
		expect(t).toContain("Step [0.1]");
		expect(t, "what ran, and how it went").toContain("S.does");
		expect(t, "where it ran and how long it took, which its record states").toContain("remote 5ms");
		expect(t).toContain("Data set (1)");
		expect(t).toContain("myVar");
	});

	it("re-keys the read when the step changes, dropping the previous step's data", async () => {
		const el = document.createElement("shu-step-detail") as ShuStepDetail;
		document.body.appendChild(el);
		await el.open(`${EXECUTION}.0.1`, SEQ_PATH_LABEL);
		await el.updateComplete;
		expect(text(el)).toContain("myVar");
		await el.open(`${EXECUTION}.0.2`, SEQ_PATH_LABEL); // the page doesn't hold a record of this step, and it doesn't have a site to call
		await el.updateComplete;
		const t = text(el);
		expect(t, "a step the page cannot read reports that, rather than claiming that the step doesn't exist").toContain("Step [0.2] wasn't read.");
		expect(refusalOf(el)?.textContent, "a site that doesn't respond offers a read again").toContain("Read again");
		expect(t).not.toContain("myVar");
	});

	it("surfaces a failed read instead of spinning forever", async () => {
		globalThis.fetch = (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
			if (url.endsWith(HANDSHAKE_PATH)) return Promise.resolve(rpcAnswer({ seqPath: [0, -1, 1] }, 200));
			return Promise.resolve(rpcAnswer({ error: "boom" }, 422));
		};
		const el = document.createElement("shu-step-detail") as ShuStepDetail;
		document.body.appendChild(el);
		await el.open(`${EXECUTION}.0.3`, SEQ_PATH_LABEL);
		await el.updateComplete;
		expect(text(el)).toContain("Step [0.3] wasn't read.");
		expect(refusalOf(el)?.textContent, "the site's refusal, as the site stated it").toContain("boom");
	});

	it("throws where a pane opens it at a record of a type whose declaration doesn't name it", async () => {
		const el = document.createElement("shu-step-detail") as ShuStepDetail;
		await expect(el.open("m-1", "Email")).rejects.toThrow("<shu-step-detail> shows a SeqPath record, and was opened at a record of Email");
	});
});
