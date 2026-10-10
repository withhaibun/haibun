// @vitest-environment jsdom
/**
 * Tests the entity store's resolution order and freshness through the real interfaces. The conduit dispatch returns the
 * results of the `getIndividualWithEdges` and `annotations` steps. Emitted events drive the live-quad path.
 *
 * `setupShuTest` hydrates a served page through `serveThePage`. `isOffline` then returns false, so these tests don't reach
 * the `offline` provenance. That provenance applies to a page that carries its own actuality record. The e2e suites
 * exercise that branch against a real browser.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openEntity, refreshAnnotations, getEntityView, subscribeEntities } from "./entity-store.js";
import { setupShuTest, makeEntityDispatch, type TShuTestHandle } from "./test-setup.js";
import { LinkRelations, SPECIFIC_RESOURCE_LABEL } from "@haibun/core/lib/resources.js";
import type { TEvent } from "./page/ports.js";
import { endPage } from "./page/adapters/page-held.js";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

const entity = (subject: string) => ({ vertex: { "@id": "e1", "@type": "Email", subject }, edges: [], incomingCount: { total: 0, saturated: false } });
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
			return over.annotations ? over.annotations() : { annotations: [] };
		},
	});
	return { dispatch, calls };
}

describe("entity-store resolution", () => {
	let handle: TShuTestHandle;
	afterEach(() => handle.teardown());
	beforeEach(endPage);

	it("is a loading stub until an individual is opened", () => {
		handle = setupShuTest(stubDispatch());
		expect(getEntityView("Email", "e1")).toEqual({ status: "loading", annotations: [], bodies: {} });
	});

	it("serves a fetched individual and its anchored annotations with `live` provenance", async () => {
		const { dispatch } = stubDispatch({ annotations: () => ({ annotations: [note("c1", "first note")] }) });
		handle = setupShuTest({ dispatch });
		await openEntity("Email", "e1", "private");
		const view = getEntityView("Email", "e1");
		expect(view.status).toBe("ready");
		expect(view.provenance).toBe("live");
		expect(view.entity?.vertex.subject).toBe("Hi");
		expect(view.annotations.map((a) => a.body)).toEqual(["first note"]);
	});

	it("serves an already-resolved individual from the session copy without refetching it", async () => {
		const { dispatch, calls } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await openEntity("Email", "e1", "private");
		expect(calls.entity).toBe(1);
		await openEntity("Email", "e1", "private");
		expect(calls.entity).toBe(1);
		expect(getEntityView("Email", "e1").provenance).toBe("cache");
	});

	it("reports the server's error when the server rejects the read of the individual", async () => {
		const { dispatch } = stubDispatch({
			entity: () => {
				throw new Error("Issuer not found: did:example:pookie");
			},
		});
		handle = setupShuTest({ dispatch });
		await openEntity("Email", "e1", "private");
		const view = getEntityView("Email", "e1");
		expect(view.status).toBe("error");
		expect(view.error).toContain("Issuer not found");
		expect(view.entity).toBeUndefined();
	});

	it("keeps two individuals apart when a label contains a space", async () => {
		const { dispatch } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await openEntity("Draft Note", "b", "private"); // would key the same as ("Draft", "Note b") under a space separator
		expect(getEntityView("Draft", "Note b").status).toBe("loading");
		expect(getEntityView("Draft Note", "b").status).toBe("ready");
	});

	it("notifies subscribers as the individual resolves", async () => {
		const { dispatch } = stubDispatch();
		handle = setupShuTest({ dispatch });
		const seen: string[] = [];
		subscribeEntities((s) => seen.push(s));
		await openEntity("Email", "e1", "private");
		expect(seen).toContain("e1");
	});
});

describe("entity-store annotations", () => {
	let handle: TShuTestHandle;
	afterEach(() => handle.teardown());
	beforeEach(endPage);

	it("re-resolves a held individual's annotations when a note is anchored on it from anywhere", async () => {
		let round = 0;
		const { dispatch } = stubDispatch({ annotations: () => ({ annotations: ++round === 1 ? [] : [note("c1", "written elsewhere")] }) });
		handle = setupShuTest({ dispatch });
		await openEntity("Email", "e1", "private");
		expect(getEntityView("Email", "e1").annotations).toEqual([]);

		handle.emit(quadEvent(SPECIFIC_RESOURCE_LABEL, "sr-c1", LinkRelations.HAS_SOURCE.rel, "e1", SPECIFIC_RESOURCE_LABEL));
		await flush();
		expect(getEntityView("Email", "e1").annotations.map((a) => a.body)).toEqual(["written elsewhere"]);
	});

	it("keeps the annotations it holds when a re-resolve fails rather than reporting an empty list", async () => {
		let round = 0;
		const { dispatch } = stubDispatch({
			annotations: () => {
				if (++round === 1) return { annotations: [note("c1", "first note")] };
				throw new Error("connection lost");
			},
		});
		handle = setupShuTest({ dispatch });
		await openEntity("Email", "e1", "private");
		expect(getEntityView("Email", "e1").annotations.map((a) => a.body)).toEqual(["first note"]);

		await refreshAnnotations("Email", "e1");
		expect(getEntityView("Email", "e1").annotations.map((a) => a.body)).toEqual(["first note"]);
	});

	it("doesn't read annotations for an individual that hasn't resolved, since the store doesn't hold its record", async () => {
		const { dispatch, calls } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await refreshAnnotations("Email", "never-opened");
		expect(calls.annotations).toBe(0);
	});
});

describe("entity-store freshness", () => {
	let handle: TShuTestHandle;
	afterEach(() => handle.teardown());
	beforeEach(endPage);

	it("applies a live property change in place and notifies without a refetch", async () => {
		const { dispatch, calls } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await openEntity("Email", "e1", "private");
		const seen: string[] = [];
		subscribeEntities((s) => seen.push(s));

		handle.emit(quadEvent("Email", "e1", "subject", "Updated"));
		await flush();
		expect(getEntityView("Email", "e1").entity?.vertex.subject).toBe("Updated");
		expect(seen).toContain("e1");
		expect(calls.entity).toBe(1);
	});

	it("leaves an edge quad to a full reopen rather than merging it as a field", async () => {
		const { dispatch } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await openEntity("Email", "e1", "private");
		handle.emit(quadEvent("Email", "e1", "inReplyTo", "e0", "Email"));
		await flush();
		expect(getEntityView("Email", "e1").entity?.vertex.inReplyTo).toBeUndefined();
	});

	it("doesn't fetch an individual the store doesn't hold when a live change names it", async () => {
		const { dispatch } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await openEntity("Email", "e1", "private");
		handle.emit(quadEvent("Email", "e2", "subject", "Other"));
		await flush();
		expect(getEntityView("Email", "e2").status).toBe("loading");
	});
});
