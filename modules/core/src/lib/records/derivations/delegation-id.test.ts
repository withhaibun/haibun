import { describe, expect, it } from "vitest";
import { CAPABILITY_KEYS, CAPABILITY_LABEL, EVERY_ACTION } from "../../domains/actions.js";
import { delegationIdOf, signingTime } from "./delegation-id.js";
import { keyedId } from "./unit-parts.js";

const DELEGATION = {
	parentCapability: "urn:zcap:root:https%3A%2F%2Fsite.test",
	controller: "did:key:z6MkTurn",
	invocationTarget: "https://site.test",
	expires: "2027-01-01T00:00:00Z",
};
const DELEGATOR = "did:key:z6MkPage";
const SIGNED_AT = signingTime(new Date("2026-11-13T12:00:00.750Z"));

describe("a delegation's id", () => {
	it("is the id its record's keys derive from the record a store holds of it, which states the key that signed it and when", () => {
		const record = { ...DELEGATION, delegator: DELEGATOR, generatedAtTime: new Date("2026-11-13T12:00:00Z"), allowedAction: ["Read:private"] };
		expect(delegationIdOf({ ...DELEGATION, allowedAction: ["Read:private"] }, DELEGATOR, SIGNED_AT)).toBe(keyedId(CAPABILITY_LABEL, CAPABILITY_KEYS, record));
		expect(delegationIdOf(DELEGATION, DELEGATOR, SIGNED_AT), "a delegation that doesn't list an action is keyed by every action").toBe(
			keyedId(CAPABILITY_LABEL, CAPABILITY_KEYS, { ...record, allowedAction: [EVERY_ACTION] }),
		);
	});

	it("differs where another key signs the same terms, or the same key signs them at another time", () => {
		expect(delegationIdOf(DELEGATION, "did:key:z6MkOther", SIGNED_AT)).not.toBe(delegationIdOf(DELEGATION, DELEGATOR, SIGNED_AT));
		expect(delegationIdOf(DELEGATION, DELEGATOR, new Date("2026-11-13T12:00:01Z"))).not.toBe(delegationIdOf(DELEGATION, DELEGATOR, SIGNED_AT));
	});

	it("is the id a root states, which ZCAP-LD derives from its target", () => {
		expect(keyedId(CAPABILITY_LABEL, CAPABILITY_KEYS, { id: DELEGATION.parentCapability, controller: DELEGATOR, invocationTarget: DELEGATION.invocationTarget })).toBe(
			DELEGATION.parentCapability,
		);
	});
});
