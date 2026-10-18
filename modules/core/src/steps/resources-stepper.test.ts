import { describe, it, expect, beforeEach } from "vitest";
import ResourcesStepper from "./resources-stepper.js";
import Haibun from "./haibun-stepper.js";
import { getDefaultWorld, getTestWorldWithOptions, testWithWorld } from "../lib/test/lib.js";
import { Access, BODY_LABEL, LinkRelations, READING_LABEL, SEQ_PATH_LABEL, SPECIFIC_RESOURCE_LABEL } from "../lib/resources.js";
import { MEDIA_TYPE } from "../lib/domains/media-types.js";
import { setPrincipal } from "../lib/pipelines/principal.js";
import { type TWorld } from "../lib/actuality/domains/world.js";
import { itemAt } from "../lib/util/item-at.js";
import { registerDomains } from "../lib/domains/domains.js";

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

describe("ResourcesStepper typed links in a feature's prose", () => {
	const PASSAGE = "Boatbuilding, dye preparation and knot work are practiced ways of doing.";
	/** A world whose store holds the passage as the Body `practice`, which a prose link cites. */
	const worldHoldingPassage = async () => {
		const world = getTestWorldWithOptions();
		const body = { id: "practice", content: PASSAGE, mediaType: MEDIA_TYPE.markdown, generatedAtTime: new Date(0).toISOString(), accessLevel: Access.public };
		await world.shared.getStore().upsertIndividual(BODY_LABEL, body);
		return world;
	};

	it("states a prose link as a fact about its step, checks that the quoted passage resolves, and reads the statement with its reading", async () => {
		const world = await worldHoldingPassage();
		const feature = ["This scenario demonstrates [a passage:citesAsEvidence](#Body:practice:~:text=Boatbuilding).", "check citations resolve", 'statements with "citesAsEvidence"'];
		const ran = await testWithWorld(world, feature.join("\n"), [Haibun, ResourcesStepper]);
		expect(ran.ok, JSON.stringify(ran.failure)).toBe(true);
		const read = itemAt(ran.featureResults, 0).stepResults.at(-1)?.products;
		expect(read).toMatchObject({
			total: 1,
			statements: [{ subject: { "@type": SEQ_PATH_LABEL }, object: { "@type": SPECIFIC_RESOURCE_LABEL }, reading: { "@type": READING_LABEL } }],
		});
	});

	it("refuses a citation whose quoted passage its source no longer states", async () => {
		const world = await worldHoldingPassage();
		const ran = await testWithWorld(world, "This scenario demonstrates [a passage:citesAsEvidence](#Body:practice:~:text=Shipwrighting).\ncheck citations resolve", [
			Haibun,
			ResourcesStepper,
		]);
		expect(ran.failure?.error.message).toMatch(/1 of 1 citations no longer resolve:\nBody "practice" no longer states/);
	});
});
