/**
 * Derives the steps offered on a record, as a viewport shows them: the record type's kaname steps first, then the steps
 * the record's own `_links` offer, then its other acts and reads.
 */
import type { TCallLink, TRecordStep } from "@haibun/core/lib/domains/hypermedia.js";
import type { TStepList } from "../machines/registry.js";
import { stepNamed } from "./steps.js";

/** Returns the verb phrase of a step: its pattern with the parameter that takes the record removed, and any remaining
 *  placeholders replaced with an ellipsis. Redundant leading type nouns matching `typeLabel` are removed. */
export function stepVerb(step: { pattern: string; gwta?: string } | string, takenParameter: string | ReadonlySet<string> | readonly string[], typeLabel?: string): string {
	const raw = typeof step === "string" ? step : (step.gwta ?? step.pattern);
	const taken = typeof takenParameter === "string" ? new Set([takenParameter]) : new Set(takenParameter);
	const labelLower = typeLabel?.toLowerCase();

	const placeholderRegex = /\{([a-zA-Z0-9_-]+)(?::[^{}]+)?\}/g;
	let result = raw.replace(placeholderRegex, (_match, name) => {
		if (taken.has(name)) return `__TAKEN_${name}__`;
		return "…";
	});

	for (const name of taken) {
		const nameLower = name.toLowerCase();
		const marker = `__TAKEN_${name}__`;
		const regex = new RegExp(`(?:\\b(\\w+)\\s+)?${marker}`, "g");
		result = result.replace(regex, (_m, word) => {
			if (word) {
				const wLower = word.toLowerCase();
				if (wLower === labelLower || wLower === nameLower || (labelLower !== undefined && wLower.includes(labelLower))) {
					return "";
				}
				return word;
			}
			return "";
		});
	}

	result = result.replace(/\s+/g, " ").trim();
	result = result.replace(/\s+(?:for|of|on|in|at|by|from)$/i, "").trim();
	return result;
}

/**
 * Returns the links to the steps a record takes, as a viewport shows them: the record type's kaname steps first, then the
 * steps the record's own `_links` offer, then its other acts and reads. Each states its verb phrase, full description, required capability, and
 * how many inputs remain to be filled.
 */
export function recordSteps(list: TStepList, label: string, id: string, recordLinks?: Record<string, TCallLink>): TRecordStep[] {
	const result: TRecordStep[] = [];
	const seenMethods = new Set<string>();

	if (recordLinks) {
		for (const [rel, link] of Object.entries(recordLinks)) {
			if (rel === "self" || rel === "collection" || rel === "describes") continue;
			if (!link.method) continue;
			const step = stepNamed(list, link.method);
			if (!step) continue;
			seenMethods.add(step.method);
			const bound = link.params === undefined ? {} : link.params;
			const boundKeys = Object.keys(bound);
			const unboundCount = Math.max(0, Object.keys(step.paramDomains).length - boundKeys.length);
			result.push({
				method: step.method,
				params: bound,
				verb: stepVerb(step, boundKeys, label),
				summary: link.summary ?? step.description,
				asks: step.read ? "read" : "act",
				capability: step.capability,
				...(step.kaname ? { kaname: true } : {}),
				unboundCount,
				rel,
			});
		}
	}

	const matchesLabel = (domain: string): { matches: boolean; isRef: boolean } => {
		if (list.domains[domain]?.persistedAs === label) return { matches: true, isRef: false };
		if (list.concerns?.persisted?.[domain]?.label === label) return { matches: true, isRef: false };
		const ref = list.concerns?.references?.[domain];
		if (ref?.targetPersistedAs === label) return { matches: true, isRef: true };
		if (ref?.targetDomain && list.domains[ref.targetDomain]?.persistedAs === label) return { matches: true, isRef: true };
		return { matches: false, isRef: false };
	};

	for (const step of list.steps) {
		if (seenMethods.has(step.method)) continue;
		if (step.method === "GraphStepper-getIndividual" || step.method === "GraphStepper-getIndividualWithEdges") continue;

		const paramEntries = Object.entries(step.paramDomains);
		const bound: Record<string, unknown> = {};

		const hasLabelParam = paramEntries.some(([name, domain]) => name === "label" && (domain === "persisted-type" || domain === "string"));
		const hasIdParam = paramEntries.some(([name, domain]) => name === "id" && (domain === "record-id" || domain === "string"));

		// A step that takes any record by its type and id, such as a comment, isn't a kaname step of this type, whatever it states.
		const anyRecord = hasLabelParam && hasIdParam;
		if (anyRecord) {
			bound.label = label;
			bound.id = id;
		} else {
			for (const [name, domain] of paramEntries) {
				const check = matchesLabel(domain);
				if (check.matches) {
					bound[name] = { id };
				}
			}
		}

		if (Object.keys(bound).length === 0) continue;

		const boundKeys = Object.keys(bound);
		const unboundCount = Math.max(0, paramEntries.length - boundKeys.length);
		seenMethods.add(step.method);
		result.push({
			method: step.method,
			params: bound,
			verb: stepVerb(step, boundKeys, label),
			summary: step.description,
			asks: step.read ? "read" : "act",
			capability: step.capability,
			...(step.kaname && !anyRecord ? { kaname: true } : {}),
			unboundCount,
		});
	}

	// A type's kaname steps lead, as the kaname contract states, then the steps the record's own links offer, then the rest.
	const rank = (s: TRecordStep): number => {
		if (s.kaname) return s.asks === "act" ? 0 : 1;
		if (s.rel !== undefined) return s.asks === "act" ? 2 : 3;
		return s.asks === "act" ? 4 : 5;
	};

	return result.sort((a, b) => {
		const rDiff = rank(a) - rank(b);
		if (rDiff !== 0) return rDiff;
		const uDiff = a.unboundCount - b.unboundCount;
		if (uDiff !== 0) return uDiff;
		return a.verb.localeCompare(b.verb);
	});
}
