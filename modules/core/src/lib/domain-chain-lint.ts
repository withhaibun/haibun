/**
 * Domain-chain lint — boot-time consistency checks over the typed step graph.
 *
 * Reports four kinds of finding so callers can decide whether to warn or error:
 *
 *   - orphan-step: a step that produces an output domain no other step consumes.
 *     Often legitimate (terminal producers, reporting steps) but can also signal
 *     a dangling integration.
 *   - starved-step: a step that consumes an input domain no other step produces
 *     and which is not satisfiable from gwta args alone. Signals a missing
 *     producer in the loaded set.
 *   - unreachable-domain: a registered domain that no step consumes AND no step
 *     produces. Dead domain.
 *   - unproduced-domain: a domain referenced as an input but no step declares it
 *     as an output. Strict subset of starved-step at the domain level.
 *
 * Pure projection over the domain-chain graph plus the domain registry. No I/O.
 * Drift detection: callers persist a snapshot of findings and diff against a new
 * snapshot to detect graph-shape regressions across boots.
 */
import type { TRegisteredDomain } from "./resources.js";
import { SOURCE_DOMAIN, type TDomainChainGraph } from "./domain-chain.js";

export type TLintFinding =
	| { kind: "orphan-step"; stepperName: string; stepName: string; outputDomain: string }
	| { kind: "starved-step"; stepperName: string; stepName: string; inputDomain: string }
	| { kind: "unreachable-domain"; domain: string }
	| { kind: "unproduced-domain"; domain: string };

export type TDomainChainLintReport = {
	findings: TLintFinding[];
	/** Counts per kind for quick inspection. */
	summary: Record<TLintFinding["kind"], number>;
};

export function lintDomainChain(graph: TDomainChainGraph, domains: Record<string, TRegisteredDomain>): TDomainChainLintReport {
	const findings: TLintFinding[] = [];

	const producedDomains = new Set<string>();
	const consumedDomains = new Set<string>();
	for (const step of graph.steps) {
		for (const d of step.outputDomains) producedDomains.add(d);
		for (const d of step.inputDomains) consumedDomains.add(d);
	}

	// Per-step orphans and starved.
	for (const step of graph.steps) {
		for (const out of step.outputDomains) {
			if (!consumedDomains.has(out)) {
				findings.push({ kind: "orphan-step", stepperName: step.stepperName, stepName: step.stepName, outputDomain: out });
			}
		}
		for (const inp of step.inputDomains) {
			if (inp === SOURCE_DOMAIN) continue;
			if (!producedDomains.has(inp)) {
				findings.push({ kind: "starved-step", stepperName: step.stepperName, stepName: step.stepName, inputDomain: inp });
			}
		}
	}

	// Domain-level findings: registered domains that are neither consumed nor produced.
	for (const key of Object.keys(domains)) {
		if (!consumedDomains.has(key) && !producedDomains.has(key)) {
			findings.push({ kind: "unreachable-domain", domain: key });
		}
		if (consumedDomains.has(key) && !producedDomains.has(key) && key !== SOURCE_DOMAIN) {
			findings.push({ kind: "unproduced-domain", domain: key });
		}
	}

	const summary: Record<TLintFinding["kind"], number> = {
		"orphan-step": 0,
		"starved-step": 0,
		"unreachable-domain": 0,
		"unproduced-domain": 0,
	};
	for (const f of findings) summary[f.kind]++;

	return { findings, summary };
}
