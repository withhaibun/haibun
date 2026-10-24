// @vitest-environment jsdom
/**
 * A thread that doesn't hold a reply links the record it was read from, and items given without a record link their type,
 * so the column leads on where it doesn't have a reply to show.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Access } from "@haibun/core/lib/domains/resources.js";
import { REF_DENOTES } from "@haibun/core/lib/domains/typed-links.js";
import { SHOW_STEP_DEFINITIONS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { setupShuTest, stepsShown, type TShuTestHandle } from "../../test/setup.js";
import { declareRegistry } from "../../test/catalog-fixture.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { ShuThreadColumn } from "./shu-thread-column.js";
import "./shu-ref-element.js";

const RELATED = { method: "GraphStepper-getRelated", stepperName: "GraphStepper", stepName: "getRelated", pattern: "getRelated", read: true, readsAt: Access.public };
const SHOWN = stepsShown([RELATED]);
const [EMAIL, MESSAGE] = ["Email", "m-1"];

describe("a thread without replies", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		handle = setupShuTest({
			dispatch: (method) => {
				if (method === SHOW_STEP_DEFINITIONS_METHOD) return SHOWN;
				if (method === RELATED.method) return { items: [], contextRoot: MESSAGE };
				throw new Error(`unexpected ${method}`);
			},
		});
		declareRegistry(SHOWN);
	});
	afterEach(() => {
		handle.teardown();
		document.body.innerHTML = "";
	});

	const unrepliedRef = (view: ShuThreadColumn) => {
		const ref = view.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.THREAD.UNREPLIED}"] shu-ref`);
		return { kind: ref?.getAttribute("kind"), target: JSON.parse(ref?.getAttribute("linkTarget") ?? "{}") };
	};

	it("links the record it was read from", async () => {
		const view = document.body.appendChild(new ShuThreadColumn());
		await view.open(EMAIL, MESSAGE);
		await view.updateComplete;
		expect(unrepliedRef(view)).toEqual({ kind: REF_DENOTES.individual, target: { persistedAs: EMAIL, id: MESSAGE } });
	});

	it("links the type of items given without a record", async () => {
		const view = document.body.appendChild(new ShuThreadColumn());
		view.openItems([], EMAIL);
		await view.updateComplete;
		expect(unrepliedRef(view)).toEqual({ kind: REF_DENOTES.type, target: { domain: EMAIL } });
	});
});
