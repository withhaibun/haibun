// @vitest-environment jsdom
/**
 * A page shows results read at one moment. A batch of what actuality recorded that changes the type the bar searches marks
 * those results as behind, whatever recorded it, and the bar reads the type's dropdown values again; an event that doesn't
 * change a record doesn't.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildConcernCatalog } from "@haibun/core/lib/domains/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { ShuActionsBar } from "./shu-actions-bar.js";
import { SHU_EVENT } from "../../domains/elements.js";
import { persistedTypeDefinition, serveThePage, setupShuTest, type TShuTestHandle } from "../../test/setup.js";
import { CHAT_STEP, chatDispatch } from "../ask/components/chat-pane.test-fake.js";
import { quadObservation } from "@haibun/core/lib/steps/domains/quad-types.js";

const TYPE = "Email";
const SELECT_VALUES = "getSelectValues";
/** How many times the page read the type's dropdown values. */
let valueReads = 0;
const A_TYPE = chatDispatch(
	(step) => {
		if (step === SELECT_VALUES) {
			valueReads++;
			return { values: {} };
		}
		throw new Error(`unexpected ${step}`);
	},
	{ steps: [CHAT_STEP.ask, SELECT_VALUES], concerns: buildConcernCatalog(mapDefinitionsToDomains([persistedTypeDefinition(TYPE, { declared: true })])) },
);

/** A quad actuality recorded in `namedGraph`, as the stream carries it. */
const recorded = (namedGraph: string) => quadObservation(`q-${namedGraph}`, 1000, [{ subject: "s", predicate: "name", object: "v", namedGraph, timestamp: 1000 }]);

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

	it("and reads the dropdown values again where a batch changes a record of the type it searches, and not for an event that doesn't change a record", async () => {
		const bar = document.body.appendChild(new ShuActionsBar());
		await bar.updateComplete;
		let marked = 0;
		document.addEventListener(SHU_EVENT.SYNC_AVAILABLE, () => marked++);
		handle.eventStream.emit({ id: "said", timestamp: 1, kind: "log", level: "info", message: "indexed" });
		await aFrame();
		expect(marked, "a log line").toBe(0);
		const readBefore = valueReads;
		handle.eventStream.emit(recorded(TYPE));
		await aFrame();
		expect(marked, "a record of the type").toBe(1);
		expect(valueReads, "and the dropdown values read again from the server").toBe(readBefore + 1);
	});
});
