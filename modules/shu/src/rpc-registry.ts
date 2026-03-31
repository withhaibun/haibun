import { SseClient } from "./sse-client.js";

/** Vertex label domain key — discovered from step.list domains that have vertex label values. */
let vertexLabelDomainKey = "";

export function getVertexLabelDomainKey(): string {
	return vertexLabelDomainKey;
}

export type StepDescriptor = {
	method: string;
	stepperName: string;
	stepName: string;
	pattern: string;
	paramDomains?: Record<string, string>;
	inputSchema?: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
};

export type DomainInfo = { description?: string; values?: string[] };

export type DomainOption = {
	key: string;
	queryLabel?: string;
	description?: string;
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

/** Build selectable domain options. Also detects the vertex label domain key (readable via getVertexLabelDomainKey()). */
export function buildDomainOptions(domains: Record<string, DomainInfo>, queryLabels: string[]): DomainOption[] {
	const queryLabelSet = new Set(queryLabels);
	const options: DomainOption[] = [];

	for (const [key, info] of Object.entries(domains)) {
		if (info.values?.length && info.values.every((v) => queryLabelSet.has(v))) {
			vertexLabelDomainKey = key;
			for (const label of info.values) {
				options.push({ key, queryLabel: label, description: `${label} vertex`, selectable: true });
			}
			continue;
		}
		if (queryLabelSet.has(key)) {
			options.push({ key, queryLabel: key, description: info.description, selectable: true });
			continue;
		}
		options.push({ key, description: info.description, selectable: false });
	}

	return options.sort((a, b) => (a.queryLabel ?? a.key).localeCompare(b.queryLabel ?? b.key));
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
	// Find domain keys that relate to this label (domain whose values include it, or key contains the label)
	const contextDomains = new Set<string>();
	for (const [key, info] of Object.entries(cachedDomains)) {
		if (info.values?.includes(label)) contextDomains.add(key);
		if (key.toLowerCase().includes(lc)) contextDomains.add(key);
	}
	if (vertexLabelDomainKey) contextDomains.add(vertexLabelDomainKey);
	return cachedSteps.filter((step) => {
		// Match by param domain
		if (step.paramDomains && Object.values(step.paramDomains).some((domain) => contextDomains.has(domain))) return true;
		// Match by step pattern containing the label (e.g., "list contacts", "get contact")
		if (step.pattern.toLowerCase().includes(lc)) return true;
		return false;
	});
}
