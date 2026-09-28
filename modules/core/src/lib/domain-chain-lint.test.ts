import { describe, it, expect } from "vitest";
import { z } from "zod";

import { AStepper, type TStepperSteps } from "./astepper.js";
import { deriveNamingDomains, mapDefinitionsToDomains, refDomainKey } from "./domains.js";
import { LinkRelations } from "./resources.js";
import { actionOKWithProducts } from "./util/index.js";
import { OK } from "../schema/protocol.js";
import { buildDomainChain } from "./domain-chain.js";
import { LINT_FINDING, lintDomainChain, lintFindingLine } from "./domain-chain-lint.js";
import { getCoreDomains } from "./core-domains.js";
import { failWithDefaults, getDefaultWorld, passWithDefaults } from "./test/lib.js";
import { DOMAIN_TEXT } from "./domains.js";

const PERSON = "person";
const EMAIL = "email";
const ARCHIVED = "archived-email";

const GREETING = "greeting";

/** A thing a step produces: a persisted type. */
const thing = (selector: string, description: string) => ({
	selectors: [selector],
	schema: z.unknown(),
	description,
	topology: { persistedAs: selector, id: "id", properties: { id: LinkRelations.IDENTIFIER.rel } },
});

const domains = () =>
	mapDefinitionsToDomains([
		thing(PERSON, "person"),
		thing(EMAIL, "email"),
		thing(ARCHIVED, "archived email"),
		{ selectors: ["dead-registered"], schema: z.string(), description: "registered, and a step doesn't produce or consume it" },
		{ selectors: [GREETING], schema: z.enum(["hello", "goodbye"]), description: "a value its caller writes" },
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

class LooselyTyped extends AStepper {
	steps: TStepperSteps = {
		named: { gwta: "name {who}", action: () => OK },
		stated: { gwta: "state {what: string}", action: () => OK },
		either: { gwta: `either {target: string | ${PERSON}}`, action: () => OK },
		typed: { gwta: `greet {who: ${PERSON}}`, action: () => OK },
	};
}

class StubStepper extends AStepper {
	steps: TStepperSteps = {
		nothing: { gwta: "nothing here", action: () => OK },
	};
}

describe("lintDomainChain", () => {
	it("reports unsupplied-step for a step whose input domain the other steps don't produce", () => {
		// Only EmailFromPerson is loaded. It consumes PERSON but a step doesn't produce PERSON.
		const graph = buildDomainChain([new EmailFromPerson()], domains());
		const report = lintDomainChain(graph, domains());
		const unsupplied = report.findings.filter((f) => f.kind === "unsupplied-step");
		expect(unsupplied).toHaveLength(1);
		const first = unsupplied[0];
		if (first.kind === "unsupplied-step") expect(first.inputDomain).toBe(PERSON);
	});

	it("doesn't report unsupplied-step for a value its caller writes in the line, since a value domain doesn't name a thing", () => {
		class Greets extends AStepper {
			steps: TStepperSteps = { greet: { gwta: `say {what: ${GREETING}}`, productsDomain: EMAIL, action: () => actionOKWithProducts({ id: "e1" }) } };
		}
		const report = lintDomainChain(buildDomainChain([new Greets()], domains()), domains());
		expect(report.findings.filter((f) => f.kind === "unsupplied-step" || f.kind === "unproduced-domain")).toEqual([]);
	});

	it("takes a reference as supplied where its type is produced or a step answers with one, and its taker as taking the type", () => {
		const EMAIL_REF = refDomainKey(EMAIL);
		class RemovesEmail extends AStepper {
			steps: TStepperSteps = { remove: { gwta: `remove {email: ${EMAIL_REF}}`, action: () => OK } };
		}
		class FindsEmail extends AStepper {
			steps: TStepperSteps = { find: { gwta: "find an email", productsDomain: EMAIL_REF, action: () => actionOKWithProducts({ id: "e1" }) } };
		}
		const findings = (steppers: AStepper[]) => {
			const withRefs = deriveNamingDomains(domains());
			return lintDomainChain(buildDomainChain(steppers, withRefs), withRefs).findings;
		};
		const unsupplied = (steppers: AStepper[], stepName: string) => findings(steppers).filter((f) => f.kind === LINT_FINDING.UNSUPPLIED_STEP && f.stepName === stepName);
		expect(unsupplied([new RemovesEmail()], "remove"), "the steps don't produce an email").toHaveLength(1);
		expect(unsupplied([new RemovesEmail(), new EmailFromPerson()], "remove"), "a step issuing an email supplies a reference to one").toEqual([]);
		expect(unsupplied([new ArchiveEmail(), new FindsEmail()], "archive"), "a step answering with a reference supplies the email it refers to").toEqual([]);
		expect(findings([new RemovesEmail()]).map(lintFindingLine), "a step taking a reference to an email takes an email").toContain(`unproduced-domain ${EMAIL}`);
	});

	it("reads a step that takes a union as taking each part, so it doesn't report a part unreachable", () => {
		const [LABEL, ROLE] = ["page-label", "page-role"];
		const parts = mapDefinitionsToDomains([LABEL, ROLE].map((selector) => ({ selectors: [selector], schema: z.string(), description: selector })));
		class FindsEither extends AStepper {
			steps: TStepperSteps = { find: { gwta: `find {target: ${LABEL} | ${ROLE}}`, action: () => OK } };
		}
		const unreachable = (steppers: AStepper[]) =>
			lintDomainChain(buildDomainChain(steppers, parts), parts)
				.findings.filter((f) => f.kind === LINT_FINDING.UNREACHABLE_DOMAIN)
				.map(lintFindingLine);
		expect(unreachable([]), "while a step doesn't take them").toEqual([`unreachable-domain ${LABEL}`, `unreachable-domain ${ROLE}`]);
		expect(unreachable([new FindsEither()])).toEqual([]);
	});

	it("takes a composite a step takes as written by its caller, and what its fields name as taken", () => {
		const REQUEST = "email-request";
		const withRequest = mapDefinitionsToDomains([
			thing(PERSON, "person"),
			{ selectors: [REQUEST], schema: z.object({ from: z.string() }), description: "what an email is asked with", topology: { ranges: { from: PERSON } } },
		]);
		class SendsEmail extends AStepper {
			steps: TStepperSteps = { send: { gwta: `send {request: ${REQUEST}}`, action: () => OK } };
		}
		const lines = lintDomainChain(buildDomainChain([new SendsEmail()], withRequest), withRequest).findings.map(lintFindingLine);
		expect(lines, "the request doesn't need a producer, and the person it names does").toEqual([`unproduced-domain ${PERSON}`]);
	});

	it("doesn't report a record type or a presented view unreachable, since the store and the page reach them", () => {
		const beyondSteps = mapDefinitionsToDomains([
			thing("observed-request", "a record an observer writes"),
			{ selectors: ["a-view"], schema: z.object({}), description: "a view the page presents", ui: { component: "a-view" } },
		]);
		const report = lintDomainChain(buildDomainChain([], beyondSteps), beyondSteps);
		expect(report.findings.filter((f) => f.kind === LINT_FINDING.UNREACHABLE_DOMAIN)).toEqual([]);
	});

	it("reports unreachable-domain for a registered domain that steps don't consume or produce", () => {
		const graph = buildDomainChain([], domains());
		const report = lintDomainChain(graph, domains());
		const unreachable = report.findings.filter((f) => f.kind === "unreachable-domain").map((f) => (f.kind === "unreachable-domain" ? f.domain : ""));
		expect(unreachable).toContain("dead-registered");
	});

	it("reports unproduced-domain for a domain referenced as input but the steps don't produce it", () => {
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

	it("doesn't report a step without inputs or products", () => {
		const graph = buildDomainChain([new StubStepper()], domains());
		const report = lintDomainChain(graph, domains());
		const stepKinds = report.findings.filter((f) => f.kind === LINT_FINDING.UNSUPPLIED_STEP);
		expect(stepKinds).toHaveLength(0);
	});

	it("reports each parameter a step types as string, or as a union with it", () => {
		const report = lintDomainChain(buildDomainChain([new LooselyTyped()], domains()), domains());
		const typing = report.findings.filter((f) => f.kind === LINT_FINDING.STRING_PARAM).map(lintFindingLine);
		expect(typing).toEqual([
			"string-param LooselyTyped.named {who: string}",
			"string-param LooselyTyped.stated {what: string}",
			"string-param LooselyTyped.either {target: person | string}",
		]);
	});

	it("doesn't report a primitive domain as unreachable, since a caller supplies it and it isn't a node of the graph", () => {
		const world = getDefaultWorld();
		const withPrimitives = { ...getCoreDomains(world), ...domains() };
		const report = lintDomainChain(buildDomainChain([new StubStepper()], withPrimitives), withPrimitives);
		const unreachable = report.findings.filter((f) => f.kind === LINT_FINDING.UNREACHABLE_DOMAIN).map(lintFindingLine);
		expect(unreachable).not.toContain("unreachable-domain string");
		expect(unreachable).toContain("unreachable-domain dead-registered");
	});
});

describe("a run's step graph", () => {
	const feature = { path: "/features/f.feature", content: 'take "a note"' };
	class Untyped extends AStepper {
		steps: TStepperSteps = { take: { gwta: "take {what: string}", action: () => OK } };
	}
	class Typed extends AStepper {
		steps: TStepperSteps = { take: { gwta: `take {what: ${DOMAIN_TEXT}}`, action: () => OK } };
	}

	it("refuses to start a run whose step takes a string parameter, naming the step and the parameter", async () => {
		const refused = await failWithDefaults([feature], [Untyped]);
		expect(refused.failure?.error.message).toMatch(/the step graph is incomplete: string-param .*take \{what: string\}/);
	});

	it("starts a run whose steps name the domain of each parameter", async () => {
		expect((await passWithDefaults([feature], [Typed])).ok).toBe(true);
	});
});
