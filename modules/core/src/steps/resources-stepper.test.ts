import { describe, it, expect, beforeEach } from "vitest";
import ResourcesStepper from "./resources-stepper.js";
import { getDefaultWorld } from "../lib/test/lib.js";
import { Access, LinkRelations } from "../lib/resources.js";
import { setPrincipal } from "../lib/principal.js";
import { type TWorld } from "../lib/actuality/domains/world.js";
import { itemAt } from "../lib/util/item-at.js";
import { registerDomains } from "../lib/domains.js";

describe("ResourcesStepper comment (reply-threaded)", () => {
	let stepper: ResourcesStepper;
	let world: TWorld;

	beforeEach(async () => {
		stepper = new ResourcesStepper();
		world = getDefaultWorld() as TWorld;
		setPrincipal(world, "did:site:0");
		await stepper.setWorld(world, [stepper]);
		// The world declares the stepper's types, as a run does, so its store reads the records a comment writes.
		registerDomains(world, [stepper.cycles.getConcerns?.().domains ?? []]);
	});

	it("comment creates an individual and a narrate (reply) edge that grounds it", async () => {
		const store = world.shared.getStore();
		await store.upsertIndividual("Letter", { id: "letter-1", subject: "Test", accessLevel: Access.private });

		const result = await stepper.steps.comment.action({ label: "Letter", id: "letter-1", text: "A note" });
		expect(result.ok).toBe(true);
		const commentId = result.products?.commentId as string;
		expect(commentId).toBeTruthy();

		// narrate is a sub-property of inReplyTo: it grounds the comment and threads it on what it is about.
		const replyQuads = await store.query({ subject: commentId, predicate: LinkRelations.NARRATE.rel });
		expect(replyQuads.length).toBe(1);
		expect(itemAt(replyQuads, 0).object).toBe("letter-1");
	});

	it("a top-level comment's conversation root is the subject it is about", async () => {
		const store = world.shared.getStore();
		await store.upsertIndividual("Letter", { id: "letter-1", subject: "Test", accessLevel: Access.private });

		const result = await stepper.steps.comment.action({ label: "Letter", id: "letter-1", text: "A note" });
		expect(result.products?.contextRoot).toBe("letter-1");
	});

	it("a reply's conversation root is walked up the reply chain", async () => {
		const store = world.shared.getStore();
		await store.upsertIndividual("Letter", { id: "root-letter", subject: "Root", accessLevel: Access.private });

		const first = await stepper.steps.comment.action({ label: "Letter", id: "root-letter", text: "First" });
		const reply = await stepper.steps.comment.action({ label: "Comment", id: first.products?.commentId as string, text: "A reply to the first" });
		expect(reply.products?.contextRoot).toBe("root-letter");
	});
});
