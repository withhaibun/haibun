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
		set: (subject: string, predicate: string, object: unknown, namedGraph: string) => {
			const idx = quads.findIndex((q) => q.subject === subject && q.predicate === predicate && q.namedGraph === namedGraph);
			if (idx >= 0) quads.splice(idx, 1);
			quads.push({ subject, predicate, object, namedGraph, timestamp: Date.now() });
			return Promise.resolve();
		},
		get: (subject: string, predicate: string) => {
			for (let i = quads.length - 1; i >= 0; i--) {
				if (quads[i].subject === subject && quads[i].predicate === predicate) return Promise.resolve(quads[i].object);
			}
			return Promise.resolve(undefined);
		},
		add: (quad: Omit<TQuad, "timestamp">) => {
			quads.push({ ...quad, timestamp: Date.now() });
			return Promise.resolve();
		},
		query: (pattern: TQuadPattern) =>
			Promise.resolve(
				quads.filter(
					(q) =>
						(!pattern.subject || q.subject === pattern.subject) &&
						(!pattern.predicate || q.predicate === pattern.predicate) &&
						(!pattern.object || q.object === pattern.object) &&
						(!pattern.namedGraph || q.namedGraph === pattern.namedGraph),
				),
			),
		clear: () => {
			quads.length = 0;
			return Promise.resolve();
		},
		remove: () => Promise.resolve(),
		all: () => Promise.resolve(quads),
		upsertVertex: (label: string, data: unknown) => {
			const d = data as Record<string, unknown>;
			const id = String(d.id);
			vertices.set(`${label}:${id}`, { ...d, _label: label });
			return Promise.resolve(id);
		},
		getVertex: (label: string, id: string) => Promise.resolve(vertices.get(`${label}:${id}`) as Record<string, unknown> | undefined),
		deleteVertex: () => Promise.resolve(),
		queryVertices: () => Promise.resolve([]),
		distinctPropertyValues: () => Promise.resolve([]),
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

		const replyEdges = await store.query({ subject: annotationId, predicate: LinkRelations.IN_REPLY_TO.rel });
		expect(replyEdges.length).toBe(1);
		expect(replyEdges[0].object).toBe("email-1");

		const contextEdges = await store.query({ subject: annotationId, predicate: LinkRelations.CONTEXT.rel });
		expect(contextEdges.length).toBe(1);
		expect(contextEdges[0].object).toBe("email-1");
	});

	it("annotate inherits context from target", async () => {
		await store.upsertVertex("Email", { id: "root", subject: "Root" });
		await store.upsertVertex("Email", { id: "reply-1", subject: "Reply" });
		await store.add({ subject: "reply-1", predicate: LinkRelations.CONTEXT.rel, object: "root", namedGraph: "Email" });

		const result = await stepper.steps.annotate.action({ label: "Email", id: "reply-1", text: "Note on reply" }, fakeStep);
		const annotationId = (result.products as Record<string, unknown>).annotationId as string;

		const contextEdges = await store.query({ subject: annotationId, predicate: LinkRelations.CONTEXT.rel });
		expect(contextEdges[0].object).toBe("root");
	});

	it("getRelated returns all items sharing a context", async () => {
		await store.upsertVertex("Email", { id: "root", subject: "Original", dateSent: "2026-01-01" });
		await store.add({ subject: "root", predicate: LinkRelations.CONTEXT.rel, object: "root", namedGraph: "Email" });

		await store.upsertVertex("Email", { id: "reply-1", subject: "Reply", dateSent: "2026-01-02" });
		await store.add({ subject: "reply-1", predicate: LinkRelations.IN_REPLY_TO.rel, object: "root", namedGraph: "Email" });
		await store.add({ subject: "reply-1", predicate: LinkRelations.CONTEXT.rel, object: "root", namedGraph: "Email" });

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

	it("getRelated includes nested annotations (a11 → a1 → c1)", async () => {
		await store.upsertVertex("Contact", { id: "c1", name: "Alice" });

		// a1 annotates c1
		const r1 = await stepper.steps.annotate.action({ label: "Contact", id: "c1", text: "First note" }, fakeStep);
		const a1Id = (r1.products as Record<string, unknown>).annotationId as string;

		// a11 annotates a1
		const r2 = await stepper.steps.annotate.action({ label: "Annotation", id: a1Id, text: "Reply to first note" }, fakeStep);
		const a11Id = (r2.products as Record<string, unknown>).annotationId as string;

		// getRelated from c1 should find c1, a1, a11
		const result = await stepper.steps.getRelated.action({ label: "Contact", id: "c1" }, fakeStep);
		expect(result.ok).toBe(true);
		const products = result.products as Record<string, unknown>;
		expect(products.contextRoot).toBe("c1");
		const items = products.items as Record<string, unknown>[];
		expect(items.length).toBe(3);
		expect(items.some((v) => v._id === "c1")).toBe(true);
		expect(items.some((v) => v._id === a1Id)).toBe(true);
		expect(items.some((v) => v._id === a11Id)).toBe(true);

		// Each annotation should have _inReplyTo and _edges with targetIds
		const a1Item = items.find((v) => v._id === a1Id);
		expect(a1Item?._inReplyTo).toBe("c1");
		expect((a1Item?._edges as Array<{ type: string; targetId: string }>).some((e) => e.targetId === "c1")).toBe(true);

		const a11Item = items.find((v) => v._id === a11Id);
		expect(a11Item?._inReplyTo).toBe(a1Id);
		expect((a11Item?._edges as Array<{ type: string; targetId: string }>).some((e) => e.targetId === a1Id)).toBe(true);
	});

	it("getRelated from nested annotation walks up to find root", async () => {
		await store.upsertVertex("Contact", { id: "c1", name: "Alice" });

		const r1 = await stepper.steps.annotate.action({ label: "Contact", id: "c1", text: "First" }, fakeStep);
		const a1Id = (r1.products as Record<string, unknown>).annotationId as string;
		await stepper.steps.annotate.action({ label: "Annotation", id: a1Id, text: "Second" }, fakeStep);

		// getRelated from a1 should still find all 3 items (walks up to c1 as root)
		const result = await stepper.steps.getRelated.action({ label: "Annotation", id: a1Id }, fakeStep);
		expect(result.ok).toBe(true);
		const items = (result.products as Record<string, unknown>).items as Record<string, unknown>[];
		expect(items.length).toBe(3);
	});
});
