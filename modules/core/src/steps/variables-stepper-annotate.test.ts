import { describe, it, expect, beforeEach } from "vitest";
import VariablesStepper from "./variables-stepper.js";
import { getDefaultWorld } from "../lib/test/lib.js";
import { LinkRelations, type TWorld } from "../lib/defs.js";
import type { IQuadStore, TQuad, TQuadPattern } from "../lib/quad-types.js";

function createTestStore(): IQuadStore & { vertices: Map<string, Record<string, unknown>> } {
	const quads: TQuad[] = [];
	const vertices = new Map<string, Record<string, unknown>>();
	return {
		vertices,
		add: (quad) => { quads.push({ ...quad, timestamp: Date.now() }); },
		query: (pattern: TQuadPattern) => quads.filter((q) => (!pattern.subject || q.subject === pattern.subject) && (!pattern.predicate || q.predicate === pattern.predicate) && (!pattern.object || q.object === pattern.object) && (!pattern.namedGraph || q.namedGraph === pattern.namedGraph)),
		select: () => undefined,
		clear: () => { quads.length = 0; },
		remove: () => {},
		all: () => quads,
		upsertVertex: async (label, data) => { const d = data as Record<string, unknown>; const id = String(d.id); vertices.set(`${label}:${id}`, { ...d, _label: label }); return id; },
		getVertex: async (label, id) => vertices.get(`${label}:${id}`) as Record<string, unknown> | undefined,
		deleteVertex: async () => {},
		queryVertices: async () => [],
		distinctPropertyValues: async () => [],
	};
}

describe("VariablesStepper annotate + getRelated", () => {
	let stepper: VariablesStepper;
	let store: ReturnType<typeof createTestStore>;
	let world: TWorld;
	const fakeStep = { source: { path: "test" }, in: "test", seqPath: [0, 1], action: {} } as never;

	beforeEach(async () => {
		stepper = new VariablesStepper();
		store = createTestStore();
		world = getDefaultWorld() as TWorld;
		world.runtime["quad-store"] = store;
		await stepper.setWorld(world, [stepper]);
	});

	it("annotate creates vertex, inReplyTo edge, and context quads", async () => {
		await store.upsertVertex("Email", { id: "email-1", subject: "Test" });

		const result = await stepper.steps.annotate.action({ label: "Email", id: "email-1", text: "A note" }, fakeStep);
		expect(result.ok).toBe(true);

		const annotationId = (result.products as Record<string, unknown>).annotationId as string;
		expect(annotationId).toBeDefined();

		const annotation = await store.getVertex("Annotation", annotationId);
		expect(annotation).toBeDefined();
		expect((annotation as Record<string, unknown>).text).toBe("A note");

		const replyEdges = store.query({ subject: annotationId, predicate: LinkRelations.IN_REPLY_TO.rel });
		expect(replyEdges.length).toBe(1);
		expect(replyEdges[0].object).toBe("email-1");

		const contextEdges = store.query({ subject: annotationId, predicate: LinkRelations.CONTEXT.rel });
		expect(contextEdges.length).toBe(1);
		expect(contextEdges[0].object).toBe("email-1");
	});

	it("annotate inherits context from target", async () => {
		await store.upsertVertex("Email", { id: "root", subject: "Root" });
		await store.upsertVertex("Email", { id: "reply-1", subject: "Reply" });
		store.add({ subject: "reply-1", predicate: LinkRelations.CONTEXT.rel, object: "root", namedGraph: "Email" });

		const result = await stepper.steps.annotate.action({ label: "Email", id: "reply-1", text: "Note on reply" }, fakeStep);
		const annotationId = (result.products as Record<string, unknown>).annotationId as string;

		const contextEdges = store.query({ subject: annotationId, predicate: LinkRelations.CONTEXT.rel });
		expect(contextEdges[0].object).toBe("root");
	});

	it("getRelated returns all items sharing a context", async () => {
		await store.upsertVertex("Email", { id: "root", subject: "Original", dateSent: "2026-01-01" });
		store.add({ subject: "root", predicate: LinkRelations.CONTEXT.rel, object: "root", namedGraph: "Email" });

		await store.upsertVertex("Email", { id: "reply-1", subject: "Reply", dateSent: "2026-01-02" });
		store.add({ subject: "reply-1", predicate: LinkRelations.IN_REPLY_TO.rel, object: "root", namedGraph: "Email" });
		store.add({ subject: "reply-1", predicate: LinkRelations.CONTEXT.rel, object: "root", namedGraph: "Email" });

		const result = await stepper.steps.getRelated.action({ label: "Email", id: "reply-1" }, fakeStep);
		expect(result.ok).toBe(true);

		const products = result.products as Record<string, unknown>;
		expect(products.contextRoot).toBe("root");
		const items = products.items as Record<string, unknown>[];
		expect(items.length).toBe(2);
		expect(items[0]._id).toBe("root");
		expect(items[1]._id).toBe("reply-1");
	});

	it("getRelated includes annotations in the conversation", async () => {
		await store.upsertVertex("Email", { id: "email-1", subject: "Test", dateSent: "2026-01-01" });

		await stepper.steps.annotate.action({ label: "Email", id: "email-1", text: "My note" }, fakeStep);

		const result = await stepper.steps.getRelated.action({ label: "Email", id: "email-1" }, fakeStep);
		expect(result.ok).toBe(true);

		const items = (result.products as Record<string, unknown>).items as Record<string, unknown>[];
		expect(items.length).toBe(2);
		expect(items.some((v) => (v as Record<string, unknown>).text === "My note")).toBe(true);
	});
});
