// @vitest-environment jsdom
/** The claims the reasoner made about a record show with the record: each claim with its status, its sentence and its proof, a
 *  claim of a field the record lacks among them, and a field's status beside the field, described by the claim's sentence. */
import { heldRecordIri } from "@haibun/core/lib/test/declared-types.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { counted } from "@haibun/core/lib/domains/hypermedia.js";
import { VERDICT } from "@haibun/core/lib/domains/protocol.js";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { setupShuTest, makeEntityDispatch, type TShuTestHandle } from "../../test/setup.js";
import { endPage } from "../adapters/page-held.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import type { TRecordClaim } from "../domains/claims.js";

const TITLED = "the Task has its title";
const OWNED = "the Task has its owner";
const CONSISTENT = "the Task is consistent with the ontology";
/** The claims about the Task t1: its title proved, its missing owner unknown, and its consistency proved. */
const CLAIMS: readonly TRecordClaim[] = [
	{ test: TITLED, field: "title", verdict: VERDICT.proved, proof: "the call's facts derive the title" },
	{ test: OWNED, field: "owner", verdict: VERDICT.unknown, proof: "the call's facts don't derive the owner" },
	{ test: CONSISTENT, verdict: VERDICT.proved, proof: "the reasoner doesn't entail the Task a member of two disjoint classes" },
];

describe("shu-entity-column claims", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		endPage();
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
		handle = setupShuTest({
			dispatch: makeEntityDispatch({
				entity: () => ({ vertex: { "@id": heldRecordIri("Task", "t1"), title: "a task", status: "open" }, edges: [], incomingCount: counted(0) }),
				claims: (subject) => (subject === "Task:t1" ? CLAIMS : []),
			}),
		});
	});
	afterEach(() => handle.teardown());

	it("lists each claim with its status and proof, a claim of a field the record lacks among them", async () => {
		const el = document.body.appendChild(new ShuEntityColumn());
		await el.open("t1", "Task");
		const claims = await vi.waitFor(() => {
			const listed = [...(el.shadowRoot?.querySelectorAll(`[data-testid="${SHU_TEST_IDS.CLAIMS.CLAIM}"]`) ?? [])];
			if (listed.length === 0) throw new Error("the claims aren't shown yet");
			return listed;
		});
		expect(claims.map((claim) => claim.querySelector(`[data-testid="${SHU_TEST_IDS.CLAIMS.STATUS}"]`)?.getAttribute("aria-description"))).toEqual([TITLED, OWNED, CONSISTENT]);
		expect(claims.map((claim) => claim.querySelector(`[data-testid="${SHU_TEST_IDS.CLAIMS.STATUS}"]`)?.textContent?.trim())).toEqual(["✓ proved", "? unknown", "✓ proved"]);
		expect(claims[1]?.querySelector("details")?.textContent, "the proof of the missing field's claim").toContain("don't derive the owner");
	});

	it("shows a field's status beside its value, described by the claim's sentence", async () => {
		const el = document.body.appendChild(new ShuEntityColumn());
		await el.open("t1", "Task");
		const status = await vi.waitFor(() => {
			const found = el.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.CLAIMS.FIELD_STATUS}-title"]`);
			if (found === null || found === undefined) throw new Error("the title's status isn't shown yet");
			return found;
		});
		expect(status.getAttribute("aria-description")).toBe(TITLED);
		expect(status.closest('[data-testid="entity-field-title"]'), "beside the title's value").not.toBeNull();
	});
});
