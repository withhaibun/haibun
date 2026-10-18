// @vitest-environment jsdom
/**
 * A page shows results read at one moment. A batch of what actuality recorded that changes the type the bar searches marks
 * those results as behind, whatever recorded it; an event that doesn't change a record doesn't.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildConcernCatalog } from "@haibun/core/lib/domains/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { ShuActionsBar } from "./shu-actions-bar.js";
import { SHU_EVENT } from "../../domains/elements.js";
import { persistedTypeDefinition, serveThePage, setupShuTest, type TShuTestHandle } from "../../test/setup.js";
import { CHAT_STEP, chatDispatch } from "../ask/components/chat-pane.test-fake.js";

const TYPE = "Email";
const SELECT_VALUES = "getSelectValues";
const A_TYPE = chatDispatch(
	(step) => {
		if (step === SELECT_VALUES) return { values: {} };
		throw new Error(`unexpected ${step}`);
	},
	{ steps: [CHAT_STEP.ask, SELECT_VALUES], concerns: buildConcernCatalog(mapDefinitionsToDomains([persistedTypeDefinition(TYPE, { declared: true })])) },
);

/** A quad actuality recorded in `namedGraph`, as the stream carries it. */
const recorded = (namedGraph: string) => ({
	id: `q-${namedGraph}`,
	timestamp: 1000,
	kind: "artifact",
	artifactType: "json",
	json: { quadObservation: { subject: "s", predicate: "name", object: "v", namedGraph, timestamp: 1000 } },
});

const aFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("the actions bar marks the results behind", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		handle = setupShuTest({ dispatch: A_TYPE });
		serveThePage();
		document.body.innerHTML = "";
	});
	afterEach(() => {
		document.body.innerHTML = "";
		handle.teardown();
	});

	it("where a batch changes a record of the type it searches, and not for an event that doesn't change a record", async () => {
		const bar = new ShuActionsBar();
		document.body.appendChild(bar);
		await bar.updateComplete;
		let marked = 0;
		document.addEventListener(SHU_EVENT.SYNC_AVAILABLE, () => marked++);
		handle.eventStream.emit({ id: "said", timestamp: 1, kind: "log", level: "info", message: "indexed" });
		await aFrame();
		expect(marked, "a log line").toBe(0);
		handle.eventStream.emit(recorded(TYPE));
		await aFrame();
		expect(marked, "a record of the type").toBe(1);
	});
});
