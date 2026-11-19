// @vitest-environment jsdom
/**
 * A proof's assumption that states a value of a record links to the passage of the record's source that quotes the value, named
 * by where the passage is and the step that extracted it, which opens the source with the passage selected.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FRAME_KIND } from "@haibun/core/lib/records/domains/axioms.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { setupShuTest, makeEntityDispatch, type TShuTestHandle } from "../../../test/setup.js";
import { catalogOf } from "../../../test/catalog-fixture.js";
import { EXTRACTING_STEP, QUOTE, QUOTED_TASK_SPEC, quotedTaskEntity } from "../../../test/quoted-task.js";
import { endPage } from "../../adapters/page-held.js";
import { getAvailableSteps } from "../../controllers/registry-controller.js";
import { SHU_TAG } from "../../../domains/elements.js";
import { SHU_TEST_IDS } from "../../../domains/test-ids.js";
import "./shu-graph-source.js";

/** The step whose proof the pane reads. */
const PROVED_STEP = "1795000000000-1.0.2";
/** The proof's one assumption: the Task t1's title, as the step's check read it. */
const ASSUMPTION = "assumption 1";
const ASSUMED_TITLE = `t1 title "${QUOTE.exact}"`;
const DERIVATION = {
	text: ASSUMED_TITLE,
	summary: { classes: 0, properties: 0, individuals: 1 },
	frames: [
		{
			name: ASSUMPTION,
			kind: FRAME_KIND.individual,
			manchester: `Individual: t1 Facts: title "${QUOTE.exact}"`,
			dl: ASSUMED_TITLE,
			statement: `assumption: ${ASSUMED_TITLE}`,
			assertedBy: { persistedAs: SEQ_PATH_LABEL, id: PROVED_STEP },
			fact: { of: { persistedAs: "Task", id: "t1" }, value: QUOTE.exact },
			nodes: ["t1"],
			edges: [],
		},
	],
};

describe("shu-graph-source passages", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		endPage();
		const concerns = catalogOf({ ...QUOTED_TASK_SPEC, ui: { [SEQ_PATH_LABEL]: { component: SHU_TAG.STEP_DETAIL } } });
		handle = setupShuTest({ dispatch: makeEntityDispatch({ entity: quotedTaskEntity, derivation: () => DERIVATION, concerns }) });
	});
	afterEach(() => handle.teardown());

	it("links an assumption that states a record's value to the passage that quotes it, named by where it is quoted and the step that extracted it", async () => {
		// A why opens the pane once the page has read actuality's steps.
		await getAvailableSteps();
		const pane = document.body.appendChild(document.createElement(SHU_TAG.GRAPH_SOURCE)) as HTMLElement & { products: Record<string, unknown> };
		pane.products = { step: PROVED_STEP };
		const link = await vi.waitFor(() => {
			const found = pane.shadowRoot?.querySelector<HTMLAnchorElement>(`[data-testid="${SHU_TEST_IDS.GRAPH_SOURCE.PASSAGE}"]`);
			if (found === null || found === undefined) throw new Error("the assumption's passage isn't linked yet");
			return found;
		});
		expect(link.closest("li")?.getAttribute("data-name"), "the link is on the assumption's line").toBe(ASSUMPTION);
		expect(link.getAttribute("aria-label")).toBe(`the value ${ASSUMPTION} states as Body b1 quotes it, which step ${EXTRACTING_STEP} extracted`);
		expect(decodeURIComponent(decodeURIComponent(link.getAttribute("href") ?? "")), "the link opens the Body at the passage, as a text fragment states it").toContain(
			`e:Body:b1:~:text=${QUOTE.prefix}-,${QUOTE.exact},-${QUOTE.suffix}`,
		);
		pane.remove();
	});
});
