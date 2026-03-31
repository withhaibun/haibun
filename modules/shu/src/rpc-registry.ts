import { SseClient } from "./sse-client.js";


export type StepDescriptor = {
	method: string;
	stepperName: string;
	stepName: string;
	pattern: string;
	paramDomains?: Record<string, string>;
	inputSchema?: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
};

export type DomainInfo = { description?: string; values?: string[]; stepperName?: string; vertexLabel?: string };

export type DomainOption = {
	key: string;
	queryLabel?: string;
	description?: string;
	stepperName?: string;
	selectable: boolean;
};

export type StepListResponse = {
	steps: StepDescriptor[];
	domains: Record<string, DomainInfo>;
};

let cachedSteps: StepDescriptor[] | null = null;
let cachedDomains: Record<string, DomainInfo> | null = null;

let pendingDiscovery: Promise<StepListResponse> | null = null;

export async function getAvailableSteps(): Promise<StepDescriptor[]> {
	if (cachedSteps) return cachedSteps;
	const { steps } = await getStepList();
	return steps;
}

export async function getAvailableDomains(): Promise<Record<string, DomainInfo>> {
	if (cachedDomains) return cachedDomains;
	const { domains } = await getStepList();
	return domains;
}

/** Build selectable domain options. Vertex domains (those with vertexLabel) are selectable. */
export function buildDomainOptions(domains: Record<string, DomainInfo>): DomainOption[] {
	const options: DomainOption[] = [];

	for (const [key, info] of Object.entries(domains)) {
		if (info.vertexLabel) {
			options.push({ key, queryLabel: info.vertexLabel, description: info.description, stepperName: info.stepperName, selectable: true });
		} else {
			options.push({ key, description: info.description, stepperName: info.stepperName, selectable: false });
		}
	}

	return options.sort((a, b) => {
		if (a.selectable !== b.selectable) return a.selectable ? -1 : 1;
		return (a.queryLabel ?? a.key).localeCompare(b.queryLabel ?? b.key);
	});
}

async function getStepList(): Promise<StepListResponse> {
	if (cachedSteps && cachedDomains) return { steps: cachedSteps, domains: cachedDomains };
	if (pendingDiscovery) return pendingDiscovery;
	pendingDiscovery = discover();
	try {
		return await pendingDiscovery;
	} finally {
		pendingDiscovery = null;
	}
}

async function discover(): Promise<StepListResponse> {
	const client = SseClient.for("");
	const result = await client.rpc<StepListResponse>("step.list");
	if (!result || !Array.isArray(result.steps))
		throw new Error(`step.list returned unexpected shape — is "enable rpc" step configured before "webserver is listening"?`);
	const { steps, domains } = result;
	cachedSteps = steps;
	cachedDomains = domains;
	return { steps, domains };
}

export function findStep(name: string): StepDescriptor | undefined {
	return cachedSteps?.find((s) => s.stepName === name || s.method === name);
}

export function requireStep(name: string): string {
	const step = findStep(name);
	if (!step) throw new Error(`Step "${name}" not found in registry. Call getAvailableSteps() first.`);
	return step.method;
}

/**
 * Find steps relevant to the current vertex label.
 * Matches by: param domain, graph-query domain,
 * vertex-label domain, or step pattern containing the label name.
 */
export function stepsForContext(label: string): StepDescriptor[] {
	if (!cachedSteps || !cachedDomains) return [];
	const lc = label.toLowerCase();
	// Find domain keys that relate to this label
	const contextDomains = new Set<string>();
	for (const [key, info] of Object.entries(cachedDomains)) {
		if (info.vertexLabel === label) contextDomains.add(key);
		if (key.toLowerCase().includes(lc)) contextDomains.add(key);
	}
	return cachedSteps.filter((step) => {
		// Match by param domain
		if (step.paramDomains && Object.values(step.paramDomains).some((domain) => contextDomains.has(domain))) return true;
		// Match by step pattern containing the label (e.g., "list contacts", "get contact")
		if (step.pattern.toLowerCase().includes(lc)) return true;
		return false;
	});
}
