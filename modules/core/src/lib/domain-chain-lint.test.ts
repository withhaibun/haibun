import { describe, it, expect } from "vitest";
import { z } from "zod";

import { AStepper, type TStepperSteps } from "./astepper.js";
import { mapDefinitionsToDomains } from "./domains.js";
import { actionOKWithProducts } from "./util/index.js";
import { OK } from "../schema/protocol.js";
import { buildDomainChain } from "./domain-chain.js";
import { LINT_FINDING, lintDomainChain, lintFindingLine } from "./domain-chain-lint.js";
import { getCoreDomains } from "./core-domains.js";
import { getDefaultWorld } from "./test/lib.js";

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
			productsDomain: EMAIL,
			action: () => actionOKWithProducts({ id: "e1" }),
		},
	};
}

class ArchiveEmail extends AStepper {
	steps: TStepperSteps = {
		archive: {
			gwta: `archive {email: ${EMAIL}}`,
			productsDomain: ARCHIVED,
			action: () => actionOKWithProducts({ id: "a1" }),
		},
	};
}

class UnsuppliedConsumer extends AStepper {
	steps: TStepperSteps = {
		consume: {
			gwta: `consume {who: ${PERSON}}`,
			productsDomain: ORPHAN_OUTPUT,
			action: () => actionOKWithProducts({}),
		},
	};
}

class LooselyTyped extends AStepper {
	steps: TStepperSteps = {
		named: { gwta: "name {who}", action: () => OK },
		stated: { gwta: "state {what: string}", action: () => OK },
		either: { gwta: `either {target: string | ${PERSON}}`, action: () => OK },
		typed: { gwta: `greet {who: ${PERSON}}`, action: () => OK },
		answers: { gwta: "answer", productsSchema: z.object({ said: z.string() }), action: () => actionOKWithProducts({ said: "yes" }) },
	};
}

class StubStepper extends AStepper {
	steps: TStepperSteps = {
		nothing: { gwta: "nothing here", action: () => OK },
	};
}

describe("lintDomainChain", () => {
	it("reports orphan-step for a step whose output domain no other step consumes", () => {
		const graph = buildDomainChain([new EmailFromPerson(), new UnsuppliedConsumer()], domains());
		// EmailFromPerson.issueEmail produces EMAIL, consumed by no step here.
		// UnsuppliedConsumer.consume produces ORPHAN_OUTPUT, consumed by no step.
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

	it("reports unsupplied-step for a step whose input domain no other step produces", () => {
		// Only EmailFromPerson is loaded. It consumes PERSON but nothing produces PERSON.
		const graph = buildDomainChain([new EmailFromPerson()], domains());
		const report = lintDomainChain(graph, domains());
		const unsupplied = report.findings.filter((f) => f.kind === "unsupplied-step");
		expect(unsupplied).toHaveLength(1);
		const first = unsupplied[0];
		if (first.kind === "unsupplied-step") expect(first.inputDomain).toBe(PERSON);
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
		const calculated = Object.fromEntries(Object.values(LINT_FINDING).map((kind) => [kind, 0])) as Record<string, number>;
		for (const f of report.findings) calculated[f.kind]++;
		expect(report.summary).toEqual(calculated);
	});

	it("empty stepper set produces no orphan/unsupplied findings", () => {
		const graph = buildDomainChain([new StubStepper()], domains());
		const report = lintDomainChain(graph, domains());
		const stepKinds = report.findings.filter((f) => f.kind === "orphan-step" || f.kind === "unsupplied-step");
		expect(stepKinds).toHaveLength(0);
	});

	it("reports each parameter a step types as string, or as a union with it, and products with a schema and no domain", () => {
		const report = lintDomainChain(buildDomainChain([new LooselyTyped()], domains()), domains());
		const typing = report.findings.filter((f) => f.kind === LINT_FINDING.STRING_PARAM || f.kind === LINT_FINDING.UNNAMED_PRODUCTS).map(lintFindingLine);
		expect(typing).toEqual([
			"string-param LooselyTyped.named {who: string}",
			"string-param LooselyTyped.stated {what: string}",
			"string-param LooselyTyped.either {target: person | string}",
			"unnamed-products LooselyTyped.answers",
		]);
	});

	it("reports no primitive domain as unreachable, since a caller supplies it and it is no node of the graph", () => {
		const world = getDefaultWorld();
		const withPrimitives = { ...getCoreDomains(world), ...domains() };
		const report = lintDomainChain(buildDomainChain([new StubStepper()], withPrimitives), withPrimitives);
		const unreachable = report.findings.filter((f) => f.kind === LINT_FINDING.UNREACHABLE_DOMAIN).map(lintFindingLine);
		expect(unreachable).not.toContain("unreachable-domain string");
		expect(unreachable).toContain("unreachable-domain dead-registered");
	});
});
