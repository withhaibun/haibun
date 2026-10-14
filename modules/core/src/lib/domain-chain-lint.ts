/**
 * Domain-chain lint: consistency checks over the typed step graph at boot.
 *
 * The lint reports each way the graph is incomplete. A blocking finding (`BLOCKING_FINDINGS`) stops actuality from
 * starting. The report holds the other findings. The lint doesn't report a step whose products another step doesn't
 * take. Its products are returned to the caller: the page, a feature that captures them, or a model. The graph shows
 * such a step as a leaf.
 *
 *   - unsupplied-step: a step that consumes a thing another step doesn't produce. A thing is a persisted type or a
 *     reference to one. A value its caller writes in the line doesn't need a producer (`isWrittenByCaller`).
 *   - unreachable-domain: a registered value domain that a step doesn't consume or produce. The domain is unused. The
 *     store reads and writes every record by its type, whatever writes it. The page presents a view through its
 *     component. So the lint doesn't report a persisted type or a domain with a ui component as unreachable.
 *   - unproduced-domain: a thing a step consumes and another step doesn't declare as an output. It is the domain-level
 *     form of unsupplied-step.
 *   - string-param: a parameter whose domain is `string` or a union with it.
 *
 * The lint is a pure projection of the domain-chain graph and the domain registry. It doesn't perform I/O. Each module's
 * step graph test (`test/step-graph-baseline.ts`) compares the findings with a baseline file.
 */
import { z } from "zod";
import { isPersisted, type TRegisteredDomain } from "./resources.js";
import { SOURCE_DOMAIN, buildDomainChain, type TDomainChainGraph } from "./domain-chain.js";
import type { AStepper } from "./steps/domains/stepper.js";
import { DOMAIN_STRING, domainParts, fieldRangesOf, isPrimitiveDomain, isWrittenByCaller, refTargetOf } from "./domains.js";
import { DOMAIN_INDIVIDUAL_ADDRESS } from "./typed-links.js";

/** The kinds of finding. Each names a way the typed step graph is incomplete. */
export const LINT_FINDING = {
	UNSUPPLIED_STEP: "unsupplied-step",
	UNREACHABLE_DOMAIN: "unreachable-domain",
	UNPRODUCED_DOMAIN: "unproduced-domain",
	/** A parameter whose domain is `string` or a union with it. Such a domain doesn't name what the value is. */
	STRING_PARAM: "string-param",
} as const;

const stepFinding = { stepperName: z.string(), stepName: z.string() };
export const LintFindingSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal(LINT_FINDING.UNSUPPLIED_STEP), ...stepFinding, inputDomain: z.string() }).strict(),
	z.object({ kind: z.literal(LINT_FINDING.UNREACHABLE_DOMAIN), domain: z.string() }).strict(),
	z.object({ kind: z.literal(LINT_FINDING.UNPRODUCED_DOMAIN), domain: z.string() }).strict(),
	z.object({ kind: z.literal(LINT_FINDING.STRING_PARAM), ...stepFinding, param: z.string(), domain: z.string() }).strict(),
]);
export type TLintFinding = z.infer<typeof LintFindingSchema>;
type TLintKind = TLintFinding["kind"];

export const LintSummarySchema = z.object(Object.fromEntries(Object.values(LINT_FINDING).map((kind) => [kind, z.number()])) as Record<TLintKind, z.ZodNumber>).strict();

type TDomainChainLintReport = {
	findings: TLintFinding[];
	/** The number of findings of each kind. */
	summary: Record<TLintKind, number>;
};

/** The kinds of finding that stop actuality from starting: a parameter whose domain doesn't state what its value is. A
 *  step's declaration determines this finding, whatever other steppers actuality loads. An unsupplied step and an
 *  unproduced domain depend on the steppers actuality loads. They also depend on records written outside steps, such as
 *  the site's Principal. So actuality reports them and starts. Each module's step graph test compares them with its
 *  baseline, with every stepper the module declares. */
const BLOCKING_FINDINGS: readonly TLintKind[] = [LINT_FINDING.STRING_PARAM];

/** Returns a finding as one line: its kind, then the step or domain that the finding names. */
export function lintFindingLine(finding: TLintFinding): string {
	switch (finding.kind) {
		case LINT_FINDING.UNSUPPLIED_STEP:
			return `${finding.kind} ${finding.stepperName}.${finding.stepName} consumes ${finding.inputDomain}`;
		case LINT_FINDING.STRING_PARAM:
			return `${finding.kind} ${finding.stepperName}.${finding.stepName} {${finding.param}: ${finding.domain}}`;
		case LINT_FINDING.UNREACHABLE_DOMAIN:
		case LINT_FINDING.UNPRODUCED_DOMAIN:
			return `${finding.kind} ${finding.domain}`;
	}
}

export function lintDomainChain(graph: TDomainChainGraph, domains: Record<string, TRegisteredDomain>): TDomainChainLintReport {
	const findings: TLintFinding[] = [];

	const producedDomains = new Set<string>();
	const consumedDomains = new Set<string>();
	for (const step of graph.steps) {
		for (const d of step.outputDomains) producedDomains.add(d);
		for (const d of step.inputDomains) consumedDomains.add(d);
	}
	// A step that takes a union takes each of its parts. A step that takes a composite takes the domains its fields name.
	for (const key of [...consumedDomains]) for (const part of domainParts(key)) consumedDomains.add(part);
	for (const key of [...consumedDomains]) for (const named of fieldRangesOf(domains[key], domains)) consumedDomains.add(named);
	// An individual address holds its type and its id. So a step that returns one supplies a record of every persisted
	// type. A create of any declared type returns one.
	if (producedDomains.has(DOMAIN_INDIVIDUAL_ADDRESS)) for (const [key, domain] of Object.entries(domains)) if (isPersisted(domain.topology)) producedDomains.add(key);
	// A reference to a record is supplied wherever a record of its type is produced, as the goal resolver chains it. A
	// step that returns a reference supplies the record it references. A step that takes the reference takes that record.
	for (const [key, domain] of Object.entries(domains)) {
		const target = refTargetOf(domain, domains);
		if (target === undefined) continue;
		if (producedDomains.has(target)) producedDomains.add(key);
		if (producedDomains.has(key)) producedDomains.add(target);
		if (consumedDomains.has(key)) consumedDomains.add(target);
	}

	// Per-step findings: unsupplied inputs and untyped parameters.
	for (const step of graph.steps) {
		const { stepperName, stepName } = step;
		for (const inp of step.inputDomains) {
			if (inp === SOURCE_DOMAIN) continue;
			if (!producedDomains.has(inp) && !isWrittenByCaller(inp, domains)) findings.push({ kind: LINT_FINDING.UNSUPPLIED_STEP, stepperName, stepName, inputDomain: inp });
		}
		for (const [param, domain] of Object.entries(step.params)) {
			if (domainParts(domain).includes(DOMAIN_STRING)) findings.push({ kind: LINT_FINDING.STRING_PARAM, stepperName, stepName, param, domain });
		}
	}

	// Domain-level findings. The loop skips a primitive domain, because a caller supplies its value and it isn't a node of
	// the graph. The store and the page reach a record type and a view beyond the steps (see unreachable-domain above).
	for (const [key, domain] of Object.entries(domains).filter(([k]) => !isPrimitiveDomain(k))) {
		const reachedBeyondSteps = isPersisted(domain.topology) || typeof domain.ui?.component === "string";
		if (!reachedBeyondSteps && !consumedDomains.has(key) && !producedDomains.has(key)) findings.push({ kind: LINT_FINDING.UNREACHABLE_DOMAIN, domain: key });
		if (consumedDomains.has(key) && !producedDomains.has(key) && !isWrittenByCaller(key, domains)) findings.push({ kind: LINT_FINDING.UNPRODUCED_DOMAIN, domain: key });
	}

	const summary = Object.fromEntries(Object.values(LINT_FINDING).map((kind) => [kind, 0])) as Record<TLintKind, number>;
	for (const f of findings) summary[f.kind]++;

	return { findings, summary };
}

/** The id of the artifact that holds the step graph lint report at boot. */
export const DOMAIN_CHAIN_LINT_ARTIFACT = "domain-chain.lint.startup";

/** Lints the step graph of the loaded steppers. Throws on a blocking finding, and the error names each blocking finding. */
export function lintRunStepGraph(steppers: AStepper[], domains: Record<string, TRegisteredDomain>): TDomainChainLintReport {
	const report = lintDomainChain(buildDomainChain(steppers, domains), domains);
	const blocking = report.findings.filter((finding) => BLOCKING_FINDINGS.includes(finding.kind));
	if (blocking.length > 0) throw new Error(`the step graph is incomplete: ${blocking.map(lintFindingLine).join("; ")}`);
	return report;
}
