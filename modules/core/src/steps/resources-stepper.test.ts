import { describe, it, expect, beforeEach } from "vitest";
import ResourcesStepper from "./resources-stepper.js";
import { getDefaultWorld } from "../lib/test/lib.js";
import { LinkRelations } from "../lib/resources.js";
import { type TWorld } from "../lib/world.js";

describe("ResourcesStepper comment + getRelated", () => {
	let stepper: ResourcesStepper;
	let world: TWorld;
	const fakeStep = { source: { path: "test" }, in: "test", seqPath: [0, 1], action: {} } as never;

	beforeEach(async () => {
		stepper = new ResourcesStepper();
		world = getDefaultWorld() as TWorld;
		await stepper.setWorld(world, [stepper]);
	});

	it("comment creates vertex, inReplyTo edge, and context quads", async () => {
		const store = world.shared.getStore();
		await store.upsertVertex("Email", { id: "email-1", subject: "Test" });

		const result = await stepper.steps.comment.action({ label: "Email", id: "email-1", text: "A note" }, fakeStep);
		expect(result.ok).toBe(true);
		const commentId = result.products?.commentId as string;
		expect(commentId).toBeTruthy();

		const replyQuads = await store.query({ subject: commentId, predicate: LinkRelations.IN_REPLY_TO.rel });
		expect(replyQuads.length).toBe(1);
		expect(replyQuads[0].object).toBe("email-1");

		const contextQuads = await store.query({ subject: commentId, predicate: LinkRelations.CONTEXT.rel });
		expect(contextQuads.length).toBe(1);
		expect(contextQuads[0].object).toBe("email-1");
	});

	it("comment inherits context from target", async () => {
		const store = world.shared.getStore();
		await store.upsertVertex("Email", { id: "email-1", subject: "Test" });
		await store.add({ subject: "email-1", predicate: LinkRelations.CONTEXT.rel, object: "thread-root", namedGraph: "Email" });

		const result = await stepper.steps.comment.action({ label: "Email", id: "email-1", text: "Inherits context" }, fakeStep);
		expect(result.ok).toBe(true);
		const commentId = result.products?.commentId as string;

		const contextQuads = await store.query({ subject: commentId, predicate: LinkRelations.CONTEXT.rel });
		expect(contextQuads.length).toBe(1);
		expect(contextQuads[0].object).toBe("thread-root");
	});

	it("comment sets context on target when missing", async () => {
		const store = world.shared.getStore();
		await store.upsertVertex("Email", { id: "email-2", subject: "No context yet" });

		await stepper.steps.comment.action({ label: "Email", id: "email-2", text: "Sets context" }, fakeStep);

		const targetCtx = await store.query({ subject: "email-2", predicate: LinkRelations.CONTEXT.rel });
		expect(targetCtx.length).toBe(1);
		expect(targetCtx[0].object).toBe("email-2");
	});

	it("getRelated returns all items sharing a context", async () => {
		const store = world.shared.getStore();
		await store.upsertVertex("Email", { id: "email-3", subject: "Root" });

		await stepper.steps.comment.action({ label: "Email", id: "email-3", text: "First note" }, fakeStep);
		await stepper.steps.comment.action({ label: "Email", id: "email-3", text: "Second note" }, fakeStep);

		const result = await stepper.steps.getRelated.action({ label: "Email", id: "email-3" }, fakeStep);
		expect(result.ok).toBe(true);
		expect(result.products?.items).toBeDefined();
		const items = result.products?.items as Array<Record<string, unknown>>;
		expect(items.length).toBeGreaterThanOrEqual(2);
	});

	it("getRelated contextRoot traces up reply chain", async () => {
		const store = world.shared.getStore();
		await store.upsertVertex("Email", { id: "root-email", subject: "Root" });
		await store.add({ subject: "root-email", predicate: LinkRelations.CONTEXT.rel, object: "root-email", namedGraph: "Email" });

		const r1 = await stepper.steps.comment.action({ label: "Email", id: "root-email", text: "Note on root" }, fakeStep);
		expect(r1.products?.contextRoot).toBe("root-email");
	});

	it("comment returns contextRoot in products", async () => {
		const store = world.shared.getStore();
		await store.upsertVertex("Email", { id: "email-ctx", subject: "Has context" });
		await store.add({ subject: "email-ctx", predicate: LinkRelations.CONTEXT.rel, object: "ctx-root", namedGraph: "Email" });

		const result = await stepper.steps.comment.action({ label: "Email", id: "email-ctx", text: "Note" }, fakeStep);
		expect(result.ok).toBe(true);
		expect(result.products?.contextRoot).toBe("ctx-root");
	});
});
