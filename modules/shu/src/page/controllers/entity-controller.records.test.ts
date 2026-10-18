// @vitest-environment jsdom
/**
 * Tests the order in which a record opens, and how it stays current, through the real interfaces. The conduit dispatch returns the
 * results of the `getIndividualWithEdges` and `annotations` steps. Emitted events drive the live-quad path.
 *
 * `setupShuTest` hydrates a served page through `serveThePage`. `isOffline` then returns false, so these tests don't reach
 * the `offline` provenance. That provenance applies to a page that carries its own actuality record. The e2e suites
 * exercise that branch against a real browser.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openRecord, refreshAnnotations, recordView, followRecords } from "./entity-controller.js";
import { setupShuTest, makeEntityDispatch, annotationList, type TShuTestHandle } from "../../test/setup.js";
import { BODY_LABEL, HAS_BODY_EDGE, LinkRelations, SPECIFIC_RESOURCE_LABEL } from "@haibun/core/lib/domains/resources.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import type { TEvent } from "../ports.js";
import { endPage } from "../adapters/page-held.js";
import { LOAD_STATUS } from "../domains/load.js";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

const entity = (subject: string) => ({ vertex: { "@id": "e1", "@type": "Email", subject }, edges: [], incomingCount: { total: 0, saturated: false } });
/** The id of the body a record links once its edge is written. */
const BODY_ID = "e1-body";
/** Returns a read of a record that links its body. */
const withBody = (read: ReturnType<typeof entity>) => ({ ...read, vertex: { ...read.vertex, [HAS_BODY_EDGE]: [{ id: BODY_ID }] } });
const note = (commentId: string, body: string) => ({ commentId, specificResourceId: `sr-${commentId}`, exact: "a passage", body });

const quadEvent = (namedGraph: string, subject: string, predicate: string, object: unknown, objectType?: string): TEvent =>
	({
		id: `${subject}.q`,
		timestamp: 1,
		kind: "artifact",
		artifactType: "json",
		mimetype: "application/json",
		json: { quadObservation: { subject, predicate, object, namedGraph, ...(objectType ? { objectType } : {}), timestamp: 1 } },
	}) as unknown as TEvent;

/** Returns a dispatch for the two steps the store calls. It counts each call. A test can supply each step's result. */
function stubDispatch(over: { entity?: () => unknown; annotations?: () => unknown } = {}) {
	const calls = { entity: 0, annotations: 0 };
	const dispatch = makeEntityDispatch({
		entity: () => {
			calls.entity++;
			return over.entity ? over.entity() : entity("Hi");
		},
		annotations: () => {
			calls.annotations++;
			return over.annotations ? over.annotations() : annotationList([]);
		},
	});
	return { dispatch, calls };
}

describe("an open of a record", () => {
	let handle: TShuTestHandle;
	afterEach(() => handle.teardown());
	beforeEach(endPage);

	it("is a pending stub until an individual is opened", () => {
		handle = setupShuTest(stubDispatch());
		expect(recordView("Email", "e1")).toEqual({ status: LOAD_STATUS.PENDING, annotations: [], bodies: {} });
	});

	it("serves a fetched individual and its anchored annotations with `live` provenance", async () => {
		const { dispatch } = stubDispatch({ annotations: () => annotationList([note("c1", "first note")]) });
		handle = setupShuTest({ dispatch });
		await openRecord("Email", "e1", "private");
		const view = recordView("Email", "e1");
		expect(view.status).toBe(LOAD_STATUS.COMPLETED);
		expect(view.provenance).toBe("live");
		expect(view.entity?.vertex.subject).toBe("Hi");
		expect(view.annotations.map((a) => a.body)).toEqual(["first note"]);
	});

	it("serves an already-resolved individual from the session copy without refetching it", async () => {
		const { dispatch, calls } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await openRecord("Email", "e1", "private");
		expect(calls.entity).toBe(1);
		await openRecord("Email", "e1", "private");
		expect(calls.entity).toBe(1);
		expect(recordView("Email", "e1").provenance).toBe("cache");
	});

	it("reports the server's error when the server rejects the read of the individual", async () => {
		const { dispatch } = stubDispatch({
			entity: () => {
				throw new Error("Issuer not found: did:example:pookie");
			},
		});
		handle = setupShuTest({ dispatch });
		await openRecord("Email", "e1", "private");
		const view = recordView("Email", "e1");
		expect(view.status).toBe(LOAD_STATUS.FAILED);
		expect(view.refusal?.error).toContain("Issuer not found");
		expect(view.entity).toBeUndefined();
	});

	it("keeps two individuals apart when a label contains a space", async () => {
		const { dispatch } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await openRecord("Draft Note", "b", "private"); // would key the same as ("Draft", "Note b") under a space separator
		expect(recordView("Draft", "Note b").status).toBe(LOAD_STATUS.PENDING);
		expect(recordView("Draft Note", "b").status).toBe(LOAD_STATUS.COMPLETED);
	});

	it("notifies subscribers as the individual resolves", async () => {
		const { dispatch } = stubDispatch();
		handle = setupShuTest({ dispatch });
		const seen: string[] = [];
		followRecords((s) => seen.push(s));
		await openRecord("Email", "e1", "private");
		expect(seen).toContain("e1");
	});
});

describe("the notes of an open record", () => {
	let handle: TShuTestHandle;
	afterEach(() => handle.teardown());
	beforeEach(endPage);

	it("re-resolves a held individual's annotations when a note is anchored on it from anywhere", async () => {
		let round = 0;
		const { dispatch } = stubDispatch({ annotations: () => annotationList(++round === 1 ? [] : [note("c1", "written elsewhere")]) });
		handle = setupShuTest({ dispatch });
		await openRecord("Email", "e1", "private");
		expect(recordView("Email", "e1").annotations).toEqual([]);

		handle.emit(quadEvent(SPECIFIC_RESOURCE_LABEL, "sr-c1", LinkRelations.HAS_SOURCE.rel, "e1", SPECIFIC_RESOURCE_LABEL));
		await flush();
		expect(recordView("Email", "e1").annotations.map((a) => a.body)).toEqual(["written elsewhere"]);
	});

	it("keeps the annotations it holds when a re-resolve fails rather than reporting an empty list", async () => {
		let round = 0;
		const { dispatch } = stubDispatch({
			annotations: () => {
				if (++round === 1) return annotationList([note("c1", "first note")]);
				throw new Error("connection lost");
			},
		});
		handle = setupShuTest({ dispatch });
		await openRecord("Email", "e1", "private");
		expect(recordView("Email", "e1").annotations.map((a) => a.body)).toEqual(["first note"]);

		await refreshAnnotations("Email", "e1");
		expect(recordView("Email", "e1").annotations.map((a) => a.body)).toEqual(["first note"]);
	});

	it("doesn't read annotations for an individual that hasn't resolved, since the store doesn't hold its record", async () => {
		const { dispatch, calls } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await refreshAnnotations("Email", "never-opened");
		expect(calls.annotations).toBe(0);
	});
});

describe("an open record kept current", () => {
	let handle: TShuTestHandle;
	afterEach(() => handle.teardown());
	beforeEach(endPage);

	it("applies a live property change in place and notifies without a refetch", async () => {
		const { dispatch, calls } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await openRecord("Email", "e1", "private");
		const seen: string[] = [];
		followRecords((s) => seen.push(s));

		handle.emit(quadEvent("Email", "e1", "subject", "Updated"));
		await flush();
		expect(recordView("Email", "e1").entity?.vertex.subject).toBe("Updated");
		expect(seen).toContain("e1");
		expect(calls.entity).toBe(1);
	});

	it("reads a held record again when an edge of it is written, so a record read before its body's edge links the body", async () => {
		const reads = [entity("Hi"), withBody(entity("Hi"))];
		const { dispatch, calls } = stubDispatch({ entity: () => itemAt(reads, calls.entity - 1) });
		handle = setupShuTest({ dispatch });
		await openRecord("Email", "e1", "private");
		expect(recordView("Email", "e1").entity?.vertex[HAS_BODY_EDGE], "the record is read before its body's edge is written").toBeUndefined();
		handle.emit(quadEvent("Email", "e1", HAS_BODY_EDGE, BODY_ID, BODY_LABEL));
		await flush();
		expect(recordView("Email", "e1").entity?.vertex[HAS_BODY_EDGE]).toEqual([{ id: BODY_ID }]);
		expect(calls.entity).toBe(2);
	});

	it("reads a record again when an edge of it is written during its first read, and the first read doesn't replace the second", async () => {
		const first = Promise.withResolvers<unknown>();
		const reads = [() => first.promise, () => withBody(entity("Hi"))];
		const { dispatch, calls } = stubDispatch({ entity: () => itemAt(reads, calls.entity - 1)() });
		handle = setupShuTest({ dispatch });
		const opened = openRecord("Email", "e1", "private");
		await flush();
		handle.emit(quadEvent("Email", "e1", HAS_BODY_EDGE, BODY_ID, BODY_LABEL));
		await flush();
		first.resolve(entity("Hi"));
		await opened;
		expect(recordView("Email", "e1").entity?.vertex[HAS_BODY_EDGE], "the read that started after the edge was written").toEqual([{ id: BODY_ID }]);
	});

	it("doesn't fetch an individual the store doesn't hold when a live change names it", async () => {
		const { dispatch } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await openRecord("Email", "e1", "private");
		handle.emit(quadEvent("Email", "e2", "subject", "Other"));
		await flush();
		expect(recordView("Email", "e2").status).toBe(LOAD_STATUS.PENDING);
	});
});
