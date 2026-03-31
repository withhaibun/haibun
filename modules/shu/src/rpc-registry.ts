import { SseClient } from "./sse-client.js";
import { getConcernCatalog, setConcernCatalog } from "./rels-cache.js";
import { ConcernCatalogSchema, type TConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { z } from "zod";

export type StepDescriptor = {
	method: string;
	stepperName: string;
	stepName: string;
	pattern: string;
	params: Record<string, "string" | "number">;
	paramDomains?: Record<string, string>;
	capability?: string;
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
	concerns: TConcernCatalog;
};

const StepDescriptorSchema = z
	.object({
		method: z.string().min(1),
		stepperName: z.string().min(1),
		stepName: z.string().min(1),
		pattern: z.string().min(1),
		params: z.record(z.string(), z.union([z.literal("string"), z.literal("number")])),
		paramDomains: z.record(z.string(), z.string()).optional(),
		capability: z.string().optional(),
		inputSchema: z.record(z.string(), z.unknown()).optional(),
		outputSchema: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

const DomainInfoSchema = z
	.object({
		description: z.string().optional(),
		values: z.array(z.string()).optional(),
		stepperName: z.string().optional(),
		vertexLabel: z.string().optional(),
	})
	.strict();

const StepListResponseSchema = z
	.object({
		steps: z.array(StepDescriptorSchema),
		domains: z.record(z.string(), DomainInfoSchema),
		concerns: ConcernCatalogSchema,
	})
	.strict();

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
	const concerns = getConcernCatalog();

	return Object.values(concerns.vertices).map((vertex) => {
		const v = vertex as { label: unknown; domainKey: string };
		if (typeof v.label !== "string") throw new Error(`Concern label for domain ${v.domainKey} must be a string`);
		if (/^\s*\[.*\]\s*$/.test(v.label)) throw new Error(`Concern label for domain ${v.domainKey} looks like a stringified array: ${v.label}`);
		const info = domains[v.domainKey];
		if (!info) throw new Error(`step.list domain missing for concern domainKey: ${v.domainKey}`);
		return {
			key: v.domainKey,
			queryLabel: v.label,
			description: info.description,
			stepperName: info.stepperName,
			selectable: true,
		};
	});
}

async function getStepList(): Promise<StepListResponse> {
	if (cachedSteps && cachedDomains) return { steps: cachedSteps, domains: cachedDomains, concerns: getConcernCatalog() };
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
	const result = await client.rpc<unknown>("step.list");
	const parsed: StepListResponse = StepListResponseSchema.parse(result);
	const { steps, domains, concerns } = parsed;
	setConcernCatalog(concerns);
	for (const [label, vertex] of Object.entries(concerns.vertices)) {
		if (/^\s*\[.*\]\s*$/.test(vertex.label)) throw new Error(`step.list concern ${label} has stringified-array label: ${vertex.label}`);
	}
	cachedSteps = steps;
	cachedDomains = domains;
	return { steps, domains, concerns };
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
