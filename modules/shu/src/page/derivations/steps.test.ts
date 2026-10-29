/**
 * The steps a viewport shows a record: the steps its type takes, as links that name the record, its kaname steps first, then
 * its acts, then its reads, each with its description and the action it requires.
 */
import { describe, expect, it } from "vitest";
import { stepsShown } from "../../test/setup.js";
import { typeStepLinks } from "./steps.js";
import { Access } from "@haibun/core/lib/domains/resources.js";

const PERMIT = "Permit";
const listed = stepsShown(
	[
		{
			method: "Permits-showPermit",
			stepperName: "Permits",
			stepName: "showPermit",
			pattern: "show permit {permit}",
			description: "Shows a permit.",
			read: true,
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
		{ method: "Notes-listNotes", stepperName: "Notes", stepName: "listNotes", pattern: "list notes", description: "Lists the notes." },
	],
	{ "permit-ref": { description: "A reference to a permit." } },
);
const list = { ...listed, declared: listed.steps };

describe("the steps a viewport shows a record", () => {
	it("are its type's steps, kaname first, then acts, then reads, each naming the record and stating what it does and requires", () => {
		const links = typeStepLinks(list, PERMIT, "permit-1");
		expect(links.map((link) => [link.method, link.asks, link.kaname === true])).toEqual([
			["Permits-revokePermit", "act", true],
			["Permits-suspendPermit", "act", false],
			["Permits-showPermit", "read", false],
		]);
		expect(links[0]).toMatchObject({ params: { permit: { id: "permit-1" } }, summary: "Revokes a permit.", capability: "Permits:revokePermit" });
	});
});
