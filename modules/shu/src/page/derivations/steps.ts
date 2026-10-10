/**
 * The steps the page reads of actuality, as a view and a call look one up: by its friendly name or its method, the steps
 * that join a domain, the steps an action allows, the steps of a type, and the domain options a selector offers.
 */
import { domainParts } from "@haibun/core/lib/domains.js";
import { capabilityAllows } from "@haibun/core/lib/actions.js";
import type { TConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import type { TDomainDiscoveryInfo, TStepDefinition } from "@haibun/core/lib/step-discovery.js";
import type { TStepList } from "../machines/registry.js";

/** The index of each list's steps by both names of each step, made once per list. */
const indexes = new WeakMap<TStepList, Map<string, TStepDefinition>>();

/** Returns the index of `list`'s steps by name. Two steppers may offer one step name, and the name indexes the one that isn't
 *  a fallback; where both are alike, the name indexes the first the site listed. A method names its stepper, so it names one
 *  step. */
function stepsByName(list: TStepList): Map<string, TStepDefinition> {
	const held = indexes.get(list);
	if (held !== undefined) return held;
	const byName = new Map<string, TStepDefinition>();
	const answers = (current: TStepDefinition | undefined, step: TStepDefinition): boolean => current === undefined || (current.fallback === true && step.fallback !== true);
	for (const step of list.steps) {
		if (answers(byName.get(step.stepName), step)) byName.set(step.stepName, step);
		if (!byName.has(step.method)) byName.set(step.method, step);
	}
	indexes.set(list, byName);
	return byName;
}

/** Returns the step `name` names, by its friendly name or its method, or undefined where `list` doesn't hold one. */
export const stepNamed = (list: TStepList, name: string): TStepDefinition | undefined => stepsByName(list).get(name);

/** Returns the method of the step `name` names. Throws where `list` doesn't hold one. */
export function methodOf(list: TStepList, name: string): string {
	const step = stepNamed(list, name);
	if (step === undefined) throw new Error(`actuality's steps don't hold a step named "${name}"`);
	return step.method;
}

/** Returns the steps that take a domain and the steps that return it, the domain named by its key or by the type it persists
 *  as. A step that takes a union takes each of its parts. */
export function stepsJoining(list: TStepList, name: string): { taking: TStepDefinition[]; returning: TStepDefinition[] } {
	const keys = new Set(Object.entries(list.domains).flatMap(([key, info]) => (key === name || info.persistedAs === name ? [key] : [])));
	return {
		taking: list.steps.filter((step) => Object.values(step.paramDomains).some((domain) => domainParts(domain).some((part) => keys.has(part)))),
		returning: list.steps.filter((step) => step.productsDomain !== undefined && keys.has(step.productsDomain)),
	};
}

/** Returns the steps whose required action `action` allows. */
export const stepsAllowedBy = (list: TStepList, action: string): TStepDefinition[] => list.steps.filter((step) => capabilityAllows(action, step.capability));

/** Returns the steps of a type `label`: those that take a domain of the type or one whose key names it, and those whose
 *  pattern names it. */
export function stepsForContext(list: TStepList, label: string): TStepDefinition[] {
	const lc = label.toLowerCase();
	const contextDomains = new Set(Object.entries(list.domains).flatMap(([key, info]) => (info.persistedAs === label || key.toLowerCase().includes(lc) ? [key] : [])));
	return list.steps.filter((step) => Object.values(step.paramDomains).some((domain) => contextDomains.has(domain)) || step.pattern.toLowerCase().includes(lc));
}

/** A domain a selector offers: its key, the type it queries, its description and stepper, and the group it shows under. */
export type TDomainOption = { key: string; queryLabel: string; description: string | undefined; stepperName: string | undefined; selectable: true; group: string };

/** The groups of the type selector: the types a feature declares (`set of … by …`) and those a stepper declares. */
const DOMAIN_GROUP = { declared: "Declared", builtIn: "Built-in" } as const;

/** Returns the domain options of the persisted types `catalog` declares, the declared ones first. Throws for a concern whose
 *  label reads as a stringified list. */
export function domainOptions(catalog: TConcernCatalog, domains: Record<string, TDomainDiscoveryInfo>): TDomainOption[] {
	const options = Object.values(catalog.persisted).map((concern): TDomainOption => {
		if (/^\s*\[.*\]\s*$/.test(concern.label)) throw new Error(`the concern label of domain ${concern.domainKey} reads as a stringified list: ${concern.label}`);
		const info = domains[concern.domainKey];
		return { key: concern.domainKey, queryLabel: concern.label, description: info?.description, stepperName: info?.stepperName, selectable: true, group: concern.declared ? DOMAIN_GROUP.declared : DOMAIN_GROUP.builtIn };
	});
	return options.sort((a, b) => (a.group === b.group ? 0 : a.group === DOMAIN_GROUP.declared ? -1 : 1));
}
