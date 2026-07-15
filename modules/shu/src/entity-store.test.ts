// @vitest-environment jsdom
/**
 * The entity store's resolution ladder and freshness, driven through the real interfaces: the conduit dispatch answers the
 * `getIndividualWithEdges` and `annotations` steps, and emitted events drive the live-quad path.
 *
 * The `offline` provenance (a copy served from the persisted browser store when the fetch cannot reach the server) is
 * not reachable here: jsdom ships no IndexedDB, so the store reads as empty and resolution lands on `error` instead.
 * That branch is exercised by the e2e suites against a real browser, as with the rest of the IndexedDB surface.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openEntity, refreshAnnotations, getEntityView, subscribeEntities, resetEntityStore } from "./entity-store.js";
import { setupShuTest, type TShuTestHandle } from "./test-setup.js";
import { LinkRelations, SPECIFIC_RESOURCE_LABEL } from "@haibun/core/lib/resources.js";
import type { TEvent } from "./event-stream.js";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

const STEP_LIST = {
	steps: [
		{ method: "GraphStepper-getIndividualWithEdges", stepperName: "GraphStepper", stepName: "getIndividualWithEdges", pattern: "get vertex {label} {id}", params: {} },
		{ method: "ResourcesStepper-annotations", stepperName: "ResourcesStepper", stepName: "annotations", pattern: "get annotations for {label} {id}", params: {} },
	],
	domains: {},
	concerns: { persisted: {}, references: {} },
};

const entity = (subject: string) => ({ vertex: { "@id": "e1", "@type": "Email", subject }, edges: [], incomingCount: 0 });
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

/** A dispatch over the two steps the store calls, counting them and letting a test script per-call answers. */
function stubDispatch(over: { entity?: () => unknown; annotations?: () => unknown } = {}) {
	const calls = { entity: 0, annotations: 0 };
	const dispatch = (method: string) => {
		if (method === "step.list") return STEP_LIST;
		if (method === "GraphStepper-getIndividualWithEdges") {
			calls.entity++;
			return over.entity ? over.entity() : entity("Hi");
		}
		if (method === "ResourcesStepper-annotations") {
			calls.annotations++;
			return over.annotations ? over.annotations() : { annotations: [] };
		}
		throw new Error(`unexpected ${method}`);
	};
	return { dispatch, calls };
}

describe("entity-store resolution", () => {
	let handle: TShuTestHandle;
	afterEach(() => handle.teardown());
	beforeEach(() => resetEntityStore());

	it("is a loading stub until an individual is opened", () => {
		handle = setupShuTest(stubDispatch());
		expect(getEntityView("Email", "e1")).toEqual({ status: "loading", annotations: [], bodies: {} });
	});

	it("serves a fetched individual and the annotations anchored in it, marked as resolved live", async () => {
		const { dispatch } = stubDispatch({ annotations: () => ({ annotations: [note("c1", "first note")] }) });
		handle = setupShuTest({ dispatch });
		await openEntity("Email", "e1", "private");
		const view = getEntityView("Email", "e1");
		expect(view.status).toBe("ready");
		expect(view.provenance).toBe("live");
		expect(view.entity?.vertex.subject).toBe("Hi");
		expect(view.annotations.map((a) => a.body)).toEqual(["first note"]);
	});

	it("serves an already-resolved individual from the session copy, without refetching it", async () => {
		const { dispatch, calls } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await openEntity("Email", "e1", "private");
		expect(calls.entity).toBe(1);
		await openEntity("Email", "e1", "private");
		expect(calls.entity).toBe(1);
		expect(getEntityView("Email", "e1").provenance).toBe("cache");
	});

	it("reports the server's error when the individual cannot be fetched and no stored copy answers", async () => {
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
	beforeEach(() => resetEntityStore());

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

	it("keeps the annotations it holds when a re-resolve cannot reach the server, rather than reporting none", async () => {
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

	it("does nothing for an individual that has not resolved — there is nothing to anchor against", async () => {
		const { dispatch, calls } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await refreshAnnotations("Email", "never-opened");
		expect(calls.annotations).toBe(0);
	});
});

describe("entity-store freshness", () => {
	let handle: TShuTestHandle;
	afterEach(() => handle.teardown());
	beforeEach(() => resetEntityStore());

	it("applies a live property change in place, and notifies — no refetch", async () => {
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

	it("leaves edge quads to a full reopen, not merged as a field", async () => {
		const { dispatch } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await openEntity("Email", "e1", "private");
		handle.emit(quadEvent("Email", "e1", "inReplyTo", "e0", "Email"));
		await flush();
		expect(getEntityView("Email", "e1").entity?.vertex.inReplyTo).toBeUndefined();
	});

	it("ignores a live change for an individual it does not hold", async () => {
		const { dispatch } = stubDispatch();
		handle = setupShuTest({ dispatch });
		await openEntity("Email", "e1", "private");
		handle.emit(quadEvent("Email", "e2", "subject", "Other"));
		await flush();
		expect(getEntityView("Email", "e2").status).toBe("loading");
	});
});
