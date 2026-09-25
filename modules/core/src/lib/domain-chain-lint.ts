/**
 * Domain-chain lint, boot-time consistency checks over the typed step graph.
 *
 * Reports four kinds of finding so callers can decide whether to warn or error:
 *
 *   - orphan-step: a step that produces an output domain no other step consumes.
 *     Often legitimate (terminal producers, reporting steps) but can also signal
 *     a dangling integration.
 *   - unsupplied-step: a step that consumes a thing no other step produces: a persisted type, or a reference to one. A
 *     value its caller writes in the line, a primitive or a value domain with no topology, needs no producer.
 *   - unreachable-domain: a registered domain that no step consumes AND no step
 *     produces. Dead domain.
 *   - unproduced-domain: a thing consumed as an input that no step declares as an output. Strict subset of
 *     unsupplied-step at the domain level.
 *
 * Pure projection over the domain-chain graph plus the domain registry. No I/O.
 * Drift detection: callers persist a snapshot of findings and diff against a new
 * snapshot to detect graph-shape regressions across boots.
 */
import { z } from "zod";
import type { TRegisteredDomain } from "./resources.js";
import { SOURCE_DOMAIN, type TDomainChainGraph } from "./domain-chain.js";
import { DOMAIN_STRING, domainParts, isPrimitiveDomain, isWrittenByCaller } from "./domains.js";

/** The kinds of finding, each a way the typed step graph is incomplete. */
export const LINT_FINDING = {
	ORPHAN_STEP: "orphan-step",
	UNSUPPLIED_STEP: "unsupplied-step",
	UNREACHABLE_DOMAIN: "unreachable-domain",
	UNPRODUCED_DOMAIN: "unproduced-domain",
	/** A parameter whose domain is `string`, or a union with it, which says nothing of what the value is. */
	STRING_PARAM: "string-param",
} as const;

const stepFinding = { stepperName: z.string(), stepName: z.string() };
export const LintFindingSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal(LINT_FINDING.ORPHAN_STEP), ...stepFinding, outputDomain: z.string() }).strict(),
	z.object({ kind: z.literal(LINT_FINDING.UNSUPPLIED_STEP), ...stepFinding, inputDomain: z.string() }).strict(),
	z.object({ kind: z.literal(LINT_FINDING.UNREACHABLE_DOMAIN), domain: z.string() }).strict(),
	z.object({ kind: z.literal(LINT_FINDING.UNPRODUCED_DOMAIN), domain: z.string() }).strict(),
	z.object({ kind: z.literal(LINT_FINDING.STRING_PARAM), ...stepFinding, param: z.string(), domain: z.string() }).strict(),
]);
export type TLintFinding = z.infer<typeof LintFindingSchema>;
type TLintKind = TLintFinding["kind"];

export const LintSummarySchema = z.object(Object.fromEntries(Object.values(LINT_FINDING).map((kind) => [kind, z.number()])) as Record<TLintKind, z.ZodNumber>).strict();

export type TDomainChainLintReport = {
	findings: TLintFinding[];
	/** Counts per kind for quick inspection. */
	summary: Record<TLintKind, number>;
};

/** A finding as one line: its kind, then the step or domain it is about. */
export function lintFindingLine(finding: TLintFinding): string {
	switch (finding.kind) {
		case LINT_FINDING.ORPHAN_STEP:
			return `${finding.kind} ${finding.stepperName}.${finding.stepName} produces ${finding.outputDomain}`;
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

	// Per-step findings: orphans, unsupplied inputs, untyped parameters and unnamed products.
	for (const step of graph.steps) {
		const { stepperName, stepName } = step;
		for (const out of step.outputDomains) {
			if (!consumedDomains.has(out)) findings.push({ kind: LINT_FINDING.ORPHAN_STEP, stepperName, stepName, outputDomain: out });
		}
		for (const inp of step.inputDomains) {
			if (inp === SOURCE_DOMAIN) continue;
			if (!producedDomains.has(inp) && !isWrittenByCaller(inp, domains)) findings.push({ kind: LINT_FINDING.UNSUPPLIED_STEP, stepperName, stepName, inputDomain: inp });
		}
		for (const [param, domain] of Object.entries(step.params)) {
			if (domainParts(domain).includes(DOMAIN_STRING)) findings.push({ kind: LINT_FINDING.STRING_PARAM, stepperName, stepName, param, domain });
		}
	}

	// Domain-level findings: registered domains that are neither consumed nor produced. A primitive domain is supplied by
	// a caller and is no node of the graph, so it is neither.
	for (const key of Object.keys(domains).filter((k) => !isPrimitiveDomain(k))) {
		if (!consumedDomains.has(key) && !producedDomains.has(key)) findings.push({ kind: LINT_FINDING.UNREACHABLE_DOMAIN, domain: key });
		if (consumedDomains.has(key) && !producedDomains.has(key) && !isWrittenByCaller(key, domains)) findings.push({ kind: LINT_FINDING.UNPRODUCED_DOMAIN, domain: key });
	}

	const summary = Object.fromEntries(Object.values(LINT_FINDING).map((kind) => [kind, 0])) as Record<TLintKind, number>;
	for (const f of findings) summary[f.kind]++;

	return { findings, summary };
}
