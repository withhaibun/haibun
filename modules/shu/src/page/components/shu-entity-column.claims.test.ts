// @vitest-environment jsdom
/** The claims the reasoner made about a record show with the record: each claim with its status, its sentence and its proof, a
 *  claim of a field the record lacks among them, and a field's status beside the field, described by the claim's sentence. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { STATEMENT_STATUS, STATUS_MARK, VERDICT } from "@haibun/core/lib/domains/protocol.js";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { setupShuTest, makeEntityDispatch, type TShuTestHandle } from "../../test/setup.js";
import { endPage } from "../adapters/page-held.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { catalogOf } from "../../test/catalog-fixture.js";
import type { TRecordClaim } from "../domains/claims.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { EXTRACTING_STEP, QUOTE, QUOTED_TASK_SPEC, quotedTaskEntity } from "../../test/quoted-task.js";

const TITLED = "the Task has its title";
const OWNED = "the Task has its owner";
const CONSISTENT = "the Task is consistent with the ontology";
/** The steps that wrote the Task t1, each making claims about it. */
const WROTE = { label: SEQ_PATH_LABEL, id: "1795000000000-1.0.3", title: "1795000000000-1.0.3" };
const WROTE_AGAIN = { label: SEQ_PATH_LABEL, id: "1795000000000-1.0.4", title: "1795000000000-1.0.4" };
/** The claims about the Task t1: its title proved, its missing owner unknown, and its consistency proved, then its consistency
 *  proved again by the step that wrote it again. */
const CLAIMS: readonly TRecordClaim[] = [
	{ test: TITLED, field: "title", verdict: VERDICT.proved, proof: "the call's facts derive the title", madeBy: WROTE },
	{ test: OWNED, field: "owner", verdict: VERDICT.unknown, proof: "the call's facts don't derive the owner", madeBy: WROTE },
	{ test: CONSISTENT, verdict: VERDICT.proved, proof: "the reasoner doesn't entail the Task a member of two disjoint classes", madeBy: WROTE },
	{ test: CONSISTENT, verdict: VERDICT.proved, proof: "the reasoner doesn't entail the Task a member of two disjoint classes", madeBy: WROTE_AGAIN },
];

/** The site of the Task t1, whose title the Body b1 quotes, with `claims` about the Task. */
const taskDispatch = (claims: readonly TRecordClaim[]) =>
	makeEntityDispatch({ entity: quotedTaskEntity, claims: (subject) => (subject === "Task:t1" ? claims : []), concerns: catalogOf(QUOTED_TASK_SPEC) });

describe("shu-entity-column claims", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		endPage();
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
		handle = setupShuTest({ dispatch: taskDispatch(CLAIMS) });
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
		expect(claims.map((claim) => claim.querySelector(`[data-testid="${SHU_TEST_IDS.CLAIMS.STATUS}"]`)?.getAttribute("aria-description"))).toEqual([
			TITLED,
			OWNED,
			CONSISTENT,
			CONSISTENT,
		]);
		expect(claims.map((claim) => claim.querySelector(`[data-testid="${SHU_TEST_IDS.CLAIMS.STATUS}"]`)?.textContent?.trim())).toEqual([
			"✓ proved",
			"? unknown",
			"✓ proved",
			"✓ proved",
		]);
		expect(claims[1]?.querySelector("details")?.textContent, "the proof of the missing field's claim").toContain("don't derive the owner");
	});

	it("lists the claims of each step that wrote the record under a link to the step", async () => {
		const el = document.body.appendChild(new ShuEntityColumn());
		await el.open("t1", "Task");
		const steps = await vi.waitFor(() => {
			const listed = [...(el.shadowRoot?.querySelectorAll(`[data-testid="${SHU_TEST_IDS.CLAIMS.MADE_BY}"]`) ?? [])];
			if (listed.length === 0) throw new Error("the claims' steps aren't shown yet");
			return listed;
		});
		expect(steps.map((step) => step.textContent)).toEqual([WROTE.title, WROTE_AGAIN.title]);
		expect(
			steps.map((step) => step.closest("li")?.querySelectorAll(`[data-testid="${SHU_TEST_IDS.CLAIMS.CLAIM}"]`).length),
			"each step's claims",
		).toEqual([3, 1]);
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
		expect(status.closest(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.ENTITY_FIELD}-title"]`), "beside the title's value").not.toBeNull();
	});

	it("links a field to the passage that quotes its value, named by where it is quoted and the step that extracted it", async () => {
		const el = document.body.appendChild(new ShuEntityColumn());
		await el.open("t1", "Task");
		const link = await vi.waitFor(() => {
			const found = el.shadowRoot?.querySelector<HTMLAnchorElement>(`[data-testid="${SHU_TEST_IDS.CLAIMS.EVIDENCE}-title"]`);
			if (found === null || found === undefined) throw new Error("the title's quote isn't linked yet");
			return found;
		});
		expect(link.getAttribute("aria-label")).toBe(`the title as Body b1 quotes it, which step ${EXTRACTING_STEP} extracted`);
		expect(decodeURIComponent(decodeURIComponent(link.getAttribute("href") ?? "")), "the link opens the Body at the passage, as a text fragment states it").toContain(
			`e:Body:b1:~:text=${QUOTE.prefix}-,${QUOTE.exact},-${QUOTE.suffix}`,
		);
	});
});

describe("shu-entity-column assumed field", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		endPage();
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
		handle = setupShuTest({ dispatch: taskDispatch([]) });
	});
	afterEach(() => handle.teardown());

	it("shows a field a passage of outside input quotes as assumed where a claim hasn't determined it", async () => {
		const el = document.body.appendChild(new ShuEntityColumn());
		await el.open("t1", "Task");
		const status = await vi.waitFor(() => {
			const found = el.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.CLAIMS.FIELD_STATUS}-title"]`);
			if (found === null || found === undefined) throw new Error("the title's status isn't shown yet");
			return found;
		});
		expect(status.textContent?.trim()).toBe(`${STATUS_MARK.assumed} ${STATEMENT_STATUS.assumed}`);
		expect(status.getAttribute("aria-description")).toBe("the title rests on the passage that quotes it");
	});
});
