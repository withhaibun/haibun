import { describe, expect, it } from "vitest";
import { CAPABILITY_KEYS, CAPABILITY_LABEL, EVERY_ACTION, newProofNonce } from "../../domains/actions.js";
import { delegationIdOf } from "./delegation-id.js";
import { keyedId } from "./unit-parts.js";

const DELEGATION = {
	parentCapability: "urn:zcap:root:https%3A%2F%2Fsite.test",
	controller: "did:key:z6MkTurn",
	invocationTarget: "https://site.test",
	expires: "2027-01-01T00:00:00Z",
};
const DELEGATOR = "did:key:z6MkPage";
const NONCE = "bm9uY2Utb2YtYS1wcm9vZg";

describe("a delegation's id", () => {
	it("is the id its record's keys derive from the record a store holds of it, which states the key that signed it and its proof's nonce", () => {
		const record = { ...DELEGATION, delegator: DELEGATOR, nonce: NONCE, allowedAction: ["Read:private"] };
		expect(delegationIdOf({ ...DELEGATION, allowedAction: ["Read:private"] }, DELEGATOR, NONCE)).toBe(keyedId(CAPABILITY_LABEL, CAPABILITY_KEYS, record));
		expect(delegationIdOf(DELEGATION, DELEGATOR, NONCE), "a delegation that doesn't list an action is keyed by every action").toBe(
			keyedId(CAPABILITY_LABEL, CAPABILITY_KEYS, { ...record, allowedAction: [EVERY_ACTION] }),
		);
	});

	it("differs where another key signs the same terms, or the same key signs them again in the same millisecond", () => {
		expect(delegationIdOf(DELEGATION, "did:key:z6MkOther", NONCE)).not.toBe(delegationIdOf(DELEGATION, DELEGATOR, NONCE));
		expect(delegationIdOf(DELEGATION, DELEGATOR, newProofNonce())).not.toBe(delegationIdOf(DELEGATION, DELEGATOR, newProofNonce()));
	});

	it("is the id a root states, which ZCAP-LD derives from its target", () => {
		expect(keyedId(CAPABILITY_LABEL, CAPABILITY_KEYS, { id: DELEGATION.parentCapability, controller: DELEGATOR, invocationTarget: DELEGATION.invocationTarget })).toBe(
			DELEGATION.parentCapability,
		);
	});
});
