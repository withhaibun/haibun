// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { ShuRecordSteps } from "./shu-record-steps.js";
import { stepsShown, serveThePage, newPage } from "../../test/setup.js";
import { authorityPort } from "../authority/controllers/page-authority-controller.js";
import { catalogOf } from "../../test/catalog-fixture.js";
import { declareRegistry } from "../../test/catalog-fixture.js";
import { installAuthority, installServedConduit } from "../root.js";
import { Access } from "@haibun/core/lib/domains/resources.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";

const PERMIT = "Permit";

describe("<shu-record-steps>", () => {
	beforeEach(() => {
		newPage();
		document.body.innerHTML = "";
		serveThePage();
		installAuthority({ ...authorityPort(), may: (action: string) => action !== "Read:public" });
		installServedConduit("", () => undefined);

		const catalog = { ...catalogOf({ types: [PERMIT] }), references: { "permit-ref": { refDomain: "permit-ref", targetDomain: "permit", targetPersistedAs: PERMIT } } };

		const listed = stepsShown(
			[
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
					method: "Permits-suspendPermit",
					stepperName: "Permits",
					stepName: "suspendPermit",
					pattern: "suspend permit {permit}",
					description: "Suspends a permit.",
					kaname: true,
					paramDomains: { permit: "permit-ref" },
				},
				{
					method: "Permits-auditPermit",
					stepperName: "Permits",
					stepName: "auditPermit",
					pattern: "audit permit {permit}",
					description: "Audits a permit.",
					kaname: true,
					read: true,
					readsAt: Access.public,
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
					method: "Permits-inspectPermit",
					stepperName: "Permits",
					stepName: "inspectPermit",
					pattern: "inspect permit {permit}",
					description: "Inspects a permit.",
					read: true,
					readsAt: Access.public,
					paramDomains: { permit: "permit-ref" },
				},
			],
			{ "permit-ref": { description: "A reference to a permit.", persistedAs: PERMIT } },
			catalog,
		);

		declareRegistry({ steps: listed.steps, domains: listed.domains, concerns: catalog, predicates: [] });
	});

	it("renders up to 3 primary controls and groups the rest in more disclosure", async () => {
		const el = new ShuRecordSteps();
		el.setAttribute("label", PERMIT);
		el.setAttribute("record-id", "permit-100");
		document.body.appendChild(el);
		await el.updateComplete;

		const bar = el.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.RECORD_STEPS.ROOT}"]`);
		expect(bar).not.toBeNull();

		const buttons = Array.from(bar?.children ?? []).filter((node) => node.tagName === "BUTTON");
		expect(buttons.length).toBe(3);

		const more = el.shadowRoot?.querySelector(`details[data-testid="${SHU_TEST_IDS.RECORD_STEPS.MORE}"]`);
		expect(more).not.toBeNull();

		const moreButtons = more?.querySelectorAll("button.record-step-btn");
		expect(moreButtons?.length).toBe(2);

		const inspectBtn = more?.querySelector<HTMLButtonElement>('button[data-testid*="inspect"]');
		expect(inspectBtn?.disabled).toBe(true);
		expect(inspectBtn?.textContent).toContain("🔒");
	});

	it("expands shu-step-caller inline when a step requiring inputs is clicked", async () => {
		const el = new ShuRecordSteps();
		el.setAttribute("label", PERMIT);
		el.setAttribute("record-id", "permit-100");
		document.body.appendChild(el);
		await el.updateComplete;

		const more = el.shadowRoot?.querySelector<HTMLDetailsElement>(`details[data-testid="${SHU_TEST_IDS.RECORD_STEPS.MORE}"]`);
		const renewBtn = more?.querySelector<HTMLButtonElement>('button[data-testid*="renew"]');
		expect(renewBtn).not.toBeNull();

		renewBtn?.click();
		await el.updateComplete;

		const caller = el.shadowRoot?.querySelector("shu-step-caller");
		expect(caller).not.toBeNull();
		expect(caller?.getAttribute("step")).toBe("Permits-renewPermit");
	});
});
