/**
 * Domain-chain lint, boot-time consistency checks over the typed step graph.
 *
 * Reports each way the graph is incomplete, so callers can decide whether to warn or refuse. The lint doesn't report a step
 * whose products another step doesn't take. Its products answer whoever asked: the page, a feature that captures them,
 * or a model. The graph shows such a step as a leaf.
 *
 *   - unsupplied-step: a step that consumes a thing another step doesn't produce. A thing is a persisted type or a
 *     reference to one. A value its caller writes in the line doesn't need a producer (`isWrittenByCaller`).
 *   - unreachable-domain: a registered value domain that a step doesn't consume or produce. The domain is dead. The
 *     store reads and writes each record type by type, whoever writes it, and the page reaches a view by presenting its
 *     component, so the lint doesn't judge either by the steps alone.
 *   - unproduced-domain: a thing a step consumes and another step doesn't declare as an output. It is the domain-level
 *     form of unsupplied-step.
 *
 * Pure projection over the domain-chain graph plus the domain registry. No I/O.
 * Drift detection: callers persist a snapshot of findings and diff against a new
 * snapshot to detect graph-shape regressions across boots.
 */
import { z } from "zod";
import { isPersisted, type TRegisteredDomain } from "./resources.js";
import { SOURCE_DOMAIN, type TDomainChainGraph } from "./domain-chain.js";
import { DOMAIN_STRING, domainParts, fieldRangesOf, isPrimitiveDomain, isWrittenByCaller, refTargetOf } from "./domains.js";

/** The kinds of finding, each a way the typed step graph is incomplete. */
export const LINT_FINDING = {
	UNSUPPLIED_STEP: "unsupplied-step",
	UNREACHABLE_DOMAIN: "unreachable-domain",
	UNPRODUCED_DOMAIN: "unproduced-domain",
	/** A parameter whose domain is `string`, or a union with it, which says nothing of what the value is. */
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

export type TDomainChainLintReport = {
	findings: TLintFinding[];
	/** Counts per kind for quick inspection. */
	summary: Record<TLintKind, number>;
};

/** A finding as one line: its kind, then the step or domain it is about. */
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
	// A step taking a union takes each of its parts, and one taking a composite takes what the composite's fields name.
	for (const key of [...consumedDomains]) for (const part of domainParts(key)) consumedDomains.add(part);
	for (const key of [...consumedDomains]) for (const named of fieldRangesOf(domains[key], domains)) consumedDomains.add(named);
	// A reference to a record is supplied wherever a record of its type is produced, as the goal resolver chains it, and a
	// step answering with a reference supplies the record it refers to. A step taking the reference takes that record.
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

	// Domain-level findings. A caller supplies a primitive domain, and it isn't a node of the graph. The store and the page
	// reach a record type and a view beyond the steps (see unreachable-domain above).
	for (const [key, domain] of Object.entries(domains).filter(([k]) => !isPrimitiveDomain(k))) {
		const reachedBeyondSteps = isPersisted(domain.topology) || typeof domain.ui?.component === "string";
		if (!reachedBeyondSteps && !consumedDomains.has(key) && !producedDomains.has(key)) findings.push({ kind: LINT_FINDING.UNREACHABLE_DOMAIN, domain: key });
		if (consumedDomains.has(key) && !producedDomains.has(key) && !isWrittenByCaller(key, domains)) findings.push({ kind: LINT_FINDING.UNPRODUCED_DOMAIN, domain: key });
	}

	const summary = Object.fromEntries(Object.values(LINT_FINDING).map((kind) => [kind, 0])) as Record<TLintKind, number>;
	for (const f of findings) summary[f.kind]++;

	return { findings, summary };
}
