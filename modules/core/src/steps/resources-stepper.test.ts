import { describe, it, expect, beforeEach } from "vitest";
import ResourcesStepper from "./resources-stepper.js";
import { getDefaultWorld } from "../lib/test/lib.js";
import { LinkRelations } from "../lib/resources.js";
import { setPrincipal } from "../lib/principal.js";
import { type TWorld } from "../lib/world.js";

describe("ResourcesStepper comment (reply-threaded)", () => {
	let stepper: ResourcesStepper;
	let world: TWorld;
	const fakeStep = { source: { path: "test" }, in: "test", seqPath: [0, 1], action: {} } as never;

	beforeEach(async () => {
		stepper = new ResourcesStepper();
		world = getDefaultWorld() as TWorld;
		setPrincipal(world, "did:site:0");
		await stepper.setWorld(world, [stepper]);
	});

	it("comment creates an individual and a narrate (reply) edge that grounds it", async () => {
		const store = world.shared.getStore();
		await store.upsertIndividual("Email", { id: "email-1", subject: "Test" });

		const result = await stepper.steps.comment.action({ label: "Email", id: "email-1", text: "A note" }, fakeStep);
		expect(result.ok).toBe(true);
		const commentId = result.products?.commentId as string;
		expect(commentId).toBeTruthy();

		// narrate is a sub-property of inReplyTo: it grounds the comment and threads it on what it is about.
		const replyQuads = await store.query({ subject: commentId, predicate: LinkRelations.NARRATE.rel });
		expect(replyQuads.length).toBe(1);
		expect(replyQuads[0].object).toBe("email-1");
	});

	it("a top-level comment's conversation root is the subject it is about", async () => {
		const store = world.shared.getStore();
		await store.upsertIndividual("Email", { id: "email-1", subject: "Test" });

		const result = await stepper.steps.comment.action({ label: "Email", id: "email-1", text: "A note" }, fakeStep);
		expect(result.products?.contextRoot).toBe("email-1");
	});

	it("a reply's conversation root is walked up the reply chain", async () => {
		const store = world.shared.getStore();
		await store.upsertIndividual("Email", { id: "root-email", subject: "Root" });

		const first = await stepper.steps.comment.action({ label: "Email", id: "root-email", text: "First" }, fakeStep);
		const reply = await stepper.steps.comment.action({ label: "Comment", id: first.products?.commentId as string, text: "A reply to the first" }, fakeStep);
		expect(reply.products?.contextRoot).toBe("root-email");
	});
});
