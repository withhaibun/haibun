import type { TRegisteredOutcomeEntry } from "@haibun/core/schema/protocol.js";
import { escapeLabel, sanitizeId, truncate } from "../artifacts/mermaid-utils";

// biome-ignore lint/suspicious/noExplicitAny: complex feature structure from protocol
type Feature = any;
// biome-ignore lint/suspicious/noExplicitAny: complex step type from protocol
type Step = any;

const NODE_CLASS = {
	FEATURE: "feat",
	SCENARIO: "scen",
	STEP: "step",
	ACTIVITY: "act",
	OUTCOME: "outcome",
	OUTCOME_BG: "outcomeBg",
	ENSURE: "ens",
} as const;

const CLASS_DEFS = [
	`classDef ${NODE_CLASS.FEATURE} fill:#37474f,stroke:#263238,color:#fff`,
	`classDef ${NODE_CLASS.SCENARIO} fill:#1565c0,stroke:#0d47a1,color:#fff`,
	`classDef ${NODE_CLASS.STEP} fill:#546e7a,stroke:#37474f,color:#fff`,
	`classDef ${NODE_CLASS.ACTIVITY} fill:#6a1b9a,stroke:#4a148c,color:#fff`,
	`classDef ${NODE_CLASS.OUTCOME} fill:#2e7d32,stroke:#1b5e20,color:#fff`,
	`classDef ${NODE_CLASS.OUTCOME_BG} fill:#00695c,stroke:#004d40,color:#fff`,
	`classDef ${NODE_CLASS.ENSURE} fill:#f9a825,stroke:#f57f17,color:#000`,
].join("\n    ");

/**
 * Build a dependency graph from resolved features and registered outcomes.
 *
 * Shows: features → scenarios → steps (linear flow),
 * plus activity/outcome nodes with ensure dependencies.
 */
export function getMermaidFromResolvedFeatures(
	features: unknown[],
	registeredOutcomes?: Record<string, TRegisteredOutcomeEntry>,
): string {
	const lines: string[] = ["graph TD"];
	lines.push(`    ${CLASS_DEFS}`);
	lines.push("");

	const outcomeNodeIds = new Map<string, string>();
	const ensureEdges: Array<{ from: string; to: string }> = [];

	if (registeredOutcomes) {
		const bgOutcomes: Array<[string, TRegisteredOutcomeEntry]> = [];
		const featureOutcomes = new Map<string, Array<[string, TRegisteredOutcomeEntry]>>();

		for (const [name, entry] of Object.entries(registeredOutcomes)) {
			outcomeNodeIds.set(name, `oc_${sanitizeId(name)}`);
			if (entry.isBackground) {
				bgOutcomes.push([name, entry]);
			} else {
				const path = entry.proofPath || "unknown";
				if (!featureOutcomes.has(path)) featureOutcomes.set(path, []);
				featureOutcomes.get(path)?.push([name, entry]);
			}
		}

		if (bgOutcomes.length > 0) {
			lines.push('    subgraph bg_outcomes["Background Outcomes"]');
			for (const [name, entry] of bgOutcomes) {
				lines.push(`        ${outcomeNodeIds.get(name) ?? ""}{{"${outcomeLabel(name, entry)}"}}:::${NODE_CLASS.OUTCOME_BG}`);
			}
			lines.push("    end");
			lines.push("");
		}

		for (const [path, outcomes] of featureOutcomes) {
			lines.push(`    subgraph oc_${sanitizeId(path)}["Outcomes: ${escapeLabel(truncate(path, 40))}"]`);
			for (const [name, entry] of outcomes) {
				lines.push(`        ${outcomeNodeIds.get(name) ?? ""}{{"${outcomeLabel(name, entry)}"}}:::${NODE_CLASS.OUTCOME}`);
			}
			lines.push("    end");
			lines.push("");
		}
	}

	(features as Feature[]).forEach((feat, fIndex) => {
		const featurePath = feat.path || `feature-${fIndex}`;
		lines.push(`    subgraph f${fIndex}_sub["${escapeLabel(featurePath)}"]`);

		let lastNode: string | null = null;

		(feat.featureSteps as Step[]).forEach((step: Step, sIndex: number) => {
			const actionName: string = step.action?.actionName || "";
			const stepperName: string = step.action?.stepperName || "";

			if (actionName === "feature") return;

			const sNode = `f${fIndex}s${sIndex}`;

			if (actionName === "scenario") {
				lines.push(`        ${sNode}["Scenario: ${escapeLabel(truncate(step.in, 50))}"]:::${NODE_CLASS.SCENARIO}`);
				lastNode = sNode;
				return;
			}

			if (actionName === "activity") {
				lines.push(`        ${sNode}["Activity: ${escapeLabel(truncate(step.in, 50))}"]:::${NODE_CLASS.ACTIVITY}`);
				if (lastNode) lines.push(`        ${lastNode} --> ${sNode}`);
				lastNode = sNode;
				return;
			}

			if (actionName === "ensure" && stepperName === "ActivitiesStepper") {
				const ensureTarget = step.in?.replace(/^ensure\s+/i, "") || step.in;
				lines.push(`        ${sNode}["ensure ${escapeLabel(truncate(ensureTarget, 40))}"]:::${NODE_CLASS.ENSURE}`);
				if (lastNode) lines.push(`        ${lastNode} --> ${sNode}`);
				lastNode = sNode;
				const outcomeId = outcomeNodeIds.get(ensureTarget) ?? findOutcomeByPartialMatch(ensureTarget, outcomeNodeIds);
				if (outcomeId) ensureEdges.push({ from: sNode, to: outcomeId });
				return;
			}

			// Virtual outcome step from ActivitiesStepper
			if (stepperName === "ActivitiesStepper" && outcomeNodeIds.has(actionName)) {
				lines.push(`        ${sNode}["${escapeLabel(truncate(step.in, 50))}"]:::${NODE_CLASS.ENSURE}`);
				if (lastNode) lines.push(`        ${lastNode} --> ${sNode}`);
				lastNode = sNode;
				ensureEdges.push({ from: sNode, to: outcomeNodeIds.get(actionName) ?? "" });
				return;
			}

			lines.push(`        ${sNode}["${escapeLabel(truncate(step.in, 50))}"]:::${NODE_CLASS.STEP}`);
			if (lastNode) lines.push(`        ${lastNode} --> ${sNode}`);
			lastNode = sNode;
		});

		lines.push("    end");
		lines.push("");
	});

	for (const edge of ensureEdges) {
		lines.push(`    ${edge.from} -.->|ensure| ${edge.to}`);
	}

	return lines.join("\n");
}

function outcomeLabel(name: string, entry: TRegisteredOutcomeEntry): string {
	const proof = entry.proofStatements?.length ? ` [${truncate(entry.proofStatements.join("; "), 40)}]` : "";
	return `${escapeLabel(truncate(name, 50))}${escapeLabel(proof)}`;
}

function findOutcomeByPartialMatch(target: string, outcomeIds: Map<string, string>): string | undefined {
	const normalized = target.toLowerCase().trim();
	for (const [name, id] of outcomeIds) {
		const n = name.toLowerCase().trim();
		if (n === normalized || normalized.includes(n) || n.includes(normalized)) return id;
	}
	return undefined;
}
