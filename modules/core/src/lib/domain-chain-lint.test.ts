import { describe, it, expect } from "vitest";
import { z } from "zod";

import { AStepper, type TStepperSteps } from "./astepper.js";
import { mapDefinitionsToDomains } from "./domains.js";
import { actionOKWithProducts } from "./util/index.js";
import { OK } from "../schema/protocol.js";
import { buildDomainChain } from "./domain-chain.js";
import { lintDomainChain } from "./domain-chain-lint.js";

const PERSON = "person";
const EMAIL = "email";
const ARCHIVED = "archived-email";
const ORPHAN_OUTPUT = "orphan-output";

const domains = () =>
	mapDefinitionsToDomains([
		{ selectors: [PERSON], schema: z.unknown(), description: "person" },
		{ selectors: [EMAIL], schema: z.unknown(), description: "email" },
		{ selectors: [ARCHIVED], schema: z.unknown(), description: "archived email" },
		{ selectors: [ORPHAN_OUTPUT], schema: z.unknown(), description: "orphan output" },
		{ selectors: ["dead-registered"], schema: z.unknown(), description: "registered but no producer or consumer" },
	]);

class EmailFromPerson extends AStepper {
	steps: TStepperSteps = {
		issueEmail: {
			gwta: `issue email for {who: ${PERSON}}`,
			inputDomains: { who: PERSON },
			productsDomain: EMAIL,
			action: () => actionOKWithProducts({ id: "e1" }),
		},
	};
}

class ArchiveEmail extends AStepper {
	steps: TStepperSteps = {
		archive: {
			gwta: `archive {email: ${EMAIL}}`,
			inputDomains: { email: EMAIL },
			productsDomain: ARCHIVED,
			action: () => actionOKWithProducts({ id: "a1" }),
		},
	};
}

class StarvedConsumer extends AStepper {
	steps: TStepperSteps = {
		nourish: {
			gwta: `nourish {who: ${PERSON}}`,
			inputDomains: { who: PERSON },
			productsDomain: ORPHAN_OUTPUT,
			action: () => actionOKWithProducts({}),
		},
	};
}

class StubStepper extends AStepper {
	steps: TStepperSteps = {
		nothing: { gwta: "nothing here", action: () => OK },
	};
}

describe("lintDomainChain", () => {
	it("reports orphan-step for a step whose output domain no other step consumes", () => {
		const graph = buildDomainChain([new EmailFromPerson(), new StarvedConsumer()], domains());
		// EmailFromPerson.issueEmail produces EMAIL, consumed by no step here.
		// StarvedConsumer.nourish produces ORPHAN_OUTPUT, consumed by no step.
		const report = lintDomainChain(graph, domains());
		const orphans = report.findings.filter((f) => f.kind === "orphan-step");
		const orphanOutputs = orphans.map((o) => (o.kind === "orphan-step" ? o.outputDomain : ""));
		expect(orphanOutputs).toContain(EMAIL);
		expect(orphanOutputs).toContain(ORPHAN_OUTPUT);
	});

	it("does not report orphan-step when a consumer exists", () => {
		const graph = buildDomainChain([new EmailFromPerson(), new ArchiveEmail()], domains());
		const report = lintDomainChain(graph, domains());
		const orphans = report.findings.filter((f) => f.kind === "orphan-step" && f.outputDomain === EMAIL);
		expect(orphans).toHaveLength(0);
	});

	it("reports starved-step for a step whose input domain no other step produces", () => {
		// Only EmailFromPerson is loaded. It consumes PERSON but nothing produces PERSON.
		const graph = buildDomainChain([new EmailFromPerson()], domains());
		const report = lintDomainChain(graph, domains());
		const starved = report.findings.filter((f) => f.kind === "starved-step");
		expect(starved).toHaveLength(1);
		const first = starved[0];
		if (first.kind === "starved-step") expect(first.inputDomain).toBe(PERSON);
	});

	it("reports unreachable-domain for a registered domain neither consumed nor produced", () => {
		const graph = buildDomainChain([], domains());
		const report = lintDomainChain(graph, domains());
		const unreachable = report.findings.filter((f) => f.kind === "unreachable-domain").map((f) => (f.kind === "unreachable-domain" ? f.domain : ""));
		expect(unreachable).toContain("dead-registered");
	});

	it("reports unproduced-domain for a domain referenced as input but no step produces it", () => {
		const graph = buildDomainChain([new EmailFromPerson()], domains());
		const report = lintDomainChain(graph, domains());
		const unproduced = report.findings.filter((f) => f.kind === "unproduced-domain").map((f) => (f.kind === "unproduced-domain" ? f.domain : ""));
		expect(unproduced).toContain(PERSON);
	});

	it("summary counts match findings counts", () => {
		const graph = buildDomainChain([new EmailFromPerson(), new ArchiveEmail()], domains());
		const report = lintDomainChain(graph, domains());
		const calculated = { "orphan-step": 0, "starved-step": 0, "unreachable-domain": 0, "unproduced-domain": 0 } as Record<string, number>;
		for (const f of report.findings) calculated[f.kind]++;
		expect(report.summary).toEqual(calculated);
	});

	it("empty stepper set produces no orphan/starved findings", () => {
		const graph = buildDomainChain([new StubStepper()], domains());
		const report = lintDomainChain(graph, domains());
		const stepKinds = report.findings.filter((f) => f.kind === "orphan-step" || f.kind === "starved-step");
		expect(stepKinds).toHaveLength(0);
	});
});
