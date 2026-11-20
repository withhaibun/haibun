/**
 * An anchor quotes its Body as the Body reads where the digest it states is the Body's, and a record that targets anchors does where
 * each of its anchors does: a contract reads an edit made after an approval, and a claim one made after an extraction.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { assumedClaims, type TAnchorCheck } from "../pipelines/assumed-claims.js";
import { VERDICT } from "@haibun/core/lib/domains/protocol.js";
import { registerDomains } from "@haibun/core/lib/domains/domains.js";
import { NODE_KEY, referenceTo } from "@haibun/core/lib/records/domains/unit.js";
import { bodyDomainDefinition, readingDomainDefinition, specificResourceDomainDefinition, textQuoteSelectorDomainDefinition } from "@haibun/core/lib/domains/resource-domains.js";
import {
	Access,
	BODY_LABEL,
	COMMENT_LABEL,
	commentDomainDefinition,
	EVIDENCE_EDGE,
	GeneratedAtTimeTextSchema,
	LinkRelations,
	SPECIFIC_RESOURCE_LABEL,
} from "@haibun/core/lib/domains/resources.js";
import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { writeAnnotation } from "@haibun/core/lib/records/pipelines/discourse-writes.js";
import { testStepRecord } from "@haibun/core/lib/test/declared-types.js";
import type { TRecordName } from "@haibun/core/lib/records/domains/unit.js";
import { logicEngine, reasoner } from "../root.js";
import { contractChecks, contractProofs } from "../pipelines/contract-checks.js";
import { proofFrames } from "../derivations/proof-frames.js";
import { recordTermsOf } from "../derivations/n3.js";
import { ANCHOR_RELATIONS, anchorCurrentCheck } from "./anchor-relations.js";

/** The Body the anchors quote, as it reads, and as an edit of it reads. */
const BODY = {
	[NODE_KEY.type]: BODY_LABEL,
	id: "b1",
	content: "The rationale a grant read.",
	mediaType: MEDIA_TYPE.markdown,
	generatedAtTime: "2026-11-20T00:00:00.000Z",
	accessLevel: Access.private,
};
const EDITED = { ...BODY, content: "The rationale, edited after the grant." };

/** A type whose records cite passages as evidence of their values. */
const FINDING = {
	selectors: ["finding"],
	schema: z.object({ id: z.string(), generatedAtTime: GeneratedAtTimeTextSchema }),
	description: "A finding that cites the passages of its values",
	topology: {
		persistedAs: "Finding",
		id: "id",
		accessLevel: Access.private,
		properties: { id: LinkRelations.IDENTIFIER.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
		edges: { [EVIDENCE_EDGE.rel]: { rel: EVIDENCE_EDGE.rel, range: SPECIFIC_RESOURCE_LABEL } },
	},
};

describe("anchor_current", () => {
	const world = getDefaultWorld();
	registerDomains(world, [[bodyDomainDefinition, specificResourceDomainDefinition, textQuoteSelectorDomainDefinition, readingDomainDefinition, commentDomainDefinition]]);
	const store = world.shared.getStore();
	const checking = logicEngine().then((engine) => contractChecks(ANCHOR_RELATIONS, reasoner(), engine));
	/** The verdict of `anchor_current` over the stored record `subject` names. */
	const verdictOf = async (subject: TRecordName) => {
		const check = await checking;
		const call = { parameters: { subject: referenceTo(subject.label, subject.id) }, principal: "did:key:zReader" };
		const checked = await check(world, anchorCurrentCheck("subject", []), call);
		return checked.verdicts[0]?.verdict;
	};
	/** Writes the Body as it reads and the note `note` on a passage of it, whose anchor states the Body's digest, and returns the names of
	 *  the anchor and the note. */
	const written = async (note: string): Promise<{ anchor: TRecordName; note: TRecordName }> => {
		await store.merge(BODY);
		const vocabulary = { relRange: () => undefined, isType: () => false };
		const { commentId, specificResourceId } = await writeAnnotation(
			store,
			vocabulary,
			{ author: "did:key:zReader", step: testStepRecord("0.1") },
			{ label: BODY_LABEL, id: BODY.id, exact: "rationale", text: note },
		);
		return { anchor: { label: SPECIFIC_RESOURCE_LABEL, id: specificResourceId }, note: { label: COMMENT_LABEL, id: commentId } };
	};

	it("holds of an anchor and of the note that targets it while the Body reads as the anchor quoted it, and isn't proved once the Body is edited", { timeout: 60_000 }, async () => {
		const { anchor, note } = await written("The grant reads this rationale.");
		expect(await verdictOf(anchor)).toBe(VERDICT.proved);
		expect(await verdictOf(note)).toBe(VERDICT.proved);
		await store.merge(EDITED);
		expect(await verdictOf(anchor), "the Body changed after the anchor quoted it").toBe(VERDICT.unknown);
		expect(await verdictOf(note)).toBe(VERDICT.unknown);
	});
	it("makes the claim that a record that cites a passage quotes its Body as the Body reads, and leaves it unproved once the Body is edited", { timeout: 60_000 }, async () => {
		registerDomains(world, [[FINDING]]);
		const { anchor } = await written("The finding rests on this rationale.");
		const finding = { label: FINDING.topology.persistedAs, id: "f1" };
		await store.merge({
			[NODE_KEY.type]: finding.label,
			id: finding.id,
			generatedAtTime: BODY.generatedAtTime,
			accessLevel: Access.private,
			[EVIDENCE_EDGE.rel]: referenceTo(anchor.label, anchor.id),
		});
		const scope = { reasoner: reasoner(), store, domains: world.domains, records: world.runtime.records };
		const check: TAnchorCheck = async (record, quoting) => {
			const call = { parameters: { record: referenceTo(record.label, record.id) }, principal: "did:key:zReader" };
			const { verdicts, facts } = await (await checking)(world, anchorCurrentCheck("record", quoting), call);
			return { ...itemAt(verdicts, 0), facts };
		};
		const passages = async () =>
			(await assumedClaims(scope, [finding], check)).claims.find(({ test }) => test === `the ${finding.label}'s passages quote their Bodies as they read`)?.verdict;
		expect(await passages()).toBe(VERDICT.proved);
		const { checks } = await assumedClaims(scope, [finding], check);
		const frames = proofFrames(
			await contractProofs(ANCHOR_RELATIONS, reasoner(), checks.join("\n")),
			{ persistedAs: "SeqPath", id: "the-step" },
			recordTermsOf(world.domains, world.runtime.records),
		);
		expect(
			frames.derived.map(({ dl }) => dl),
			"the why view frames the claim's proof",
		).toContain("anchor_current(f1)");
		await store.merge(EDITED);
		expect(await passages(), "the Body changed after the passage quoted it").toBe(VERDICT.unknown);
	});
});
