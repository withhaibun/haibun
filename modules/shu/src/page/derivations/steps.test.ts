/**
 * The steps a viewport shows a record: the steps its type takes, as links that name the record, its kaname steps first, then
 * its acts, then its reads, each with its verb phrase, description and the action it requires.
 */
import { describe, expect, it } from "vitest";
import { stepsShown } from "../../test/setup.js";
import { catalogOf } from "../../test/catalog-fixture.js";
import { recordSteps, stepVerb } from "./record-steps.js";
import { Access } from "@haibun/core/lib/domains/resources.js";

const PERMIT = "Permit";
const catalog = { ...catalogOf({ types: [PERMIT] }), references: { "permit-ref": { refDomain: "permit-ref", targetDomain: "permit", targetPersistedAs: PERMIT } } };
const listed = stepsShown(
	[
		{
			method: "Permits-showPermit",
			stepperName: "Permits",
			stepName: "showPermit",
			pattern: "show permit {permit}",
			description: "Shows a permit.",
			contract: { read: true },
			readsAt: Access.public,
			paramDomains: { permit: "permit-ref" },
		},
		{
			method: "Permits-suspendPermit",
			stepperName: "Permits",
			stepName: "suspendPermit",
			pattern: "suspend permit {permit}",
			description: "Suspends a permit.",
			paramDomains: { permit: "permit-ref" },
		},
		{
			method: "Permits-revokePermit",
			stepperName: "Permits",
			stepName: "revokePermit",
			pattern: "revoke permit {permit}",
			description: "Revokes a permit.",
			kaname: true,
			paramDomains: { permit: "permit-ref" },
		},
		{
			method: "Permits-renewPermit",
			stepperName: "Permits",
			stepName: "renewPermit",
			pattern: "renew permit {permit} until {date}",
			description: "Renews a permit until a date.",
			paramDomains: { permit: "permit-ref", date: "date" },
		},
		{
			method: "Notes-noteOn",
			stepperName: "Notes",
			stepName: "noteOn",
			pattern: "note on {label} {id} with {text}",
			description: "Notes any record.",
			kaname: true,
			paramDomains: { label: "persisted-type", id: "record-id", text: "text" },
		},
		{ method: "Notes-listNotes", stepperName: "Notes", stepName: "listNotes", pattern: "list notes", description: "Lists the notes." },
	],
	{ "permit-ref": { description: "A reference to a permit.", persistedAs: PERMIT } },
	catalog,
);
const list = { ...listed, declared: listed.steps };

describe("the steps a viewport shows a record", () => {
	it("are its type's steps, its own kaname steps first, then its links, then acts and reads, where a step that takes any record isn't its kaname step, each naming the record and stating what it does and requires", () => {
		const steps = recordSteps(list, PERMIT, "permit-1", { audit: { method: "Permits-showPermit", params: { permit: { id: "permit-1" } }, summary: "Audit permit" } });
		expect(steps.map((s) => [s.method, s.verb, s.asks, s.kaname === true, s.unboundCount, s.rel])).toEqual([
			["Permits-revokePermit", "revoke", "act", true, 0, undefined],
			["Permits-showPermit", "show", "read", false, 0, "audit"],
			["Permits-suspendPermit", "suspend", "act", false, 0, undefined],
			["Notes-noteOn", "note on with …", "act", false, 1, undefined],
			["Permits-renewPermit", "renew until …", "act", false, 1, undefined],
		]);
		expect(steps[0]).toMatchObject({ params: { permit: { id: "permit-1" } }, summary: "Revokes a permit.", capability: "Permits:revokePermit" });
	});
});

describe("stepVerb", () => {
	it("derives verb phrases with zero remaining placeholders", () => {
		expect(stepVerb("revoke capability {capability}", "capability", "Capability")).toBe("revoke");
		expect(stepVerb("suspend permit {permit}", "permit", "Permit")).toBe("suspend");
		expect(stepVerb("show permit {permit}", "permit", "Permit")).toBe("show");
	});

	it("derives verb phrases with one remaining placeholder", () => {
		expect(stepVerb("delegate capability {parent: vertex-capability-ref} to {capability: capability}", "parent", "Capability")).toBe("delegate to …");
		expect(stepVerb("delegate {capability} to {controller}", "controller", "Capability")).toBe("delegate … to");
		expect(stepVerb("verify credential {credential: vertex-vc-ref} as {verifier: verifier-ref}", "credential", "VerifiableCredential")).toBe("verify as …");
	});

	it("derives verb phrases with several remaining placeholders", () => {
		expect(stepVerb("grant change request {commentId: comment-ref} for action {action: text} with {reason: text}", "commentId", "Comment")).toBe(
			"grant change request for action … with …",
		);
		expect(stepVerb("get annotations for {label} {id}", ["label", "id"], "Permit")).toBe("get annotations");
	});
});
