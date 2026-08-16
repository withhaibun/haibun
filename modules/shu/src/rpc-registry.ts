import { conduit } from "./hypermedia.js";
import { setRpcCache, findCachedMethod } from "./rpc-cache.js";
import { getConcernCatalog, setConcernCatalog } from "./rels-cache.js";
import { ConcernCatalogSchema, type TConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { z } from "zod";

export type StepDescriptor = {
	method: string;
	stepperName: string;
	stepName: string;
	pattern: string;
	params: Record<string, "string" | "number">;
	paramDomains?: Record<string, string>;
	productsDomain?: string;
	capability?: string;
	inputSchema?: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
};

export type DomainInfo = {
	description?: string;
	values?: string[];
	stepperName?: string;
	persistedAs?: string;
	ui?: Record<string, unknown>;
};

export type DomainOption = {
	key: string;
	queryLabel?: string;
	description?: string;
	stepperName?: string;
	selectable: boolean;
	/** Section heading for the type selector: "Declared" (runtime `set of …`) or "Built-in" (compiled stepper). */
	group: string;
};

/** Section headings for the type selector, partitioning on a concern's `declared` flag. */
export const DOMAIN_GROUP = { declared: "Declared", builtIn: "Built-in" } as const;

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
		productsDomain: z.string().optional(),
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
		persistedAs: z.string().optional(),
		ui: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

const StepListResponseSchema = z
	.object({
		steps: z.array(StepDescriptorSchema),
		domains: z.record(z.string(), DomainInfoSchema),
		concerns: ConcernCatalogSchema,
	})
	.strict();

// What the site said it offers, pinned to the page rather than held per bundle: a page is more than one bundle, and a
// panel a deployment adds asks the same site as the app. Held per bundle, a panel would discover the site again, and
// would not know what a step it calls requires.
const REGISTRY_KEY = "__SHU_STEP_REGISTRY__";
type TRegistry = { steps: StepDescriptor[] | null; domains: Record<string, DomainInfo> | null; concerns: TConcernCatalog | null; pending: Promise<StepListResponse> | null };
const registry = (): TRegistry => {
	const g = globalThis as unknown as Record<string, TRegistry | undefined>;
	const existing = g[REGISTRY_KEY];
	if (existing) return existing;
	const fresh: TRegistry = { steps: null, domains: null, concerns: null, pending: null };
	g[REGISTRY_KEY] = fresh;
	return fresh;
};

// Both go through the step list even when the page already has it, because the answer is only half of what asking for
// it does: the other half is this bundle reading what the site declares, which is what its views draw by.
export async function getAvailableSteps(): Promise<StepDescriptor[]> {
	return (await getStepList()).steps;
}

export async function getAvailableDomains(): Promise<Record<string, DomainInfo>> {
	return (await getStepList()).domains;
}

/** Get the stepper name for a persisted type label. */
export function getStepperForType(persistedAs: string): string | undefined {
	const domains = registry().domains;
	if (!domains) return undefined;
	for (const info of Object.values(domains)) {
		if (info.persistedAs === persistedAs) return info.stepperName;
	}
	return undefined;
}

/**
 * Build selectable domain options. Persisted domains (those with persistedAs) are
 * selectable. Partitions on `concern.declared` into "Declared" (runtime
 * `set of {domain} by …`) vs "Built-in" (compiled stepper) groups, declared
 * first so feature-authored types surface above the system ones.
 */
export function buildDomainOptions(domains: Record<string, DomainInfo>): DomainOption[] {
	const concerns = getConcernCatalog();

	const options = Object.values(concerns.persisted).map((concern) => {
		const v = concern as { label: unknown; domainKey: string; declared?: boolean };
		if (typeof v.label !== "string") throw new Error(`Concern label for domain ${v.domainKey} must be a string`);
		if (/^\s*\[.*\]\s*$/.test(v.label)) throw new Error(`Concern label for domain ${v.domainKey} looks like a stringified array: ${v.label}`);
		const info = domains[v.domainKey];
		return {
			key: v.domainKey,
			queryLabel: v.label,
			description: info?.description ?? "",
			stepperName: info?.stepperName ?? "",
			selectable: true,
			group: v.declared ? DOMAIN_GROUP.declared : DOMAIN_GROUP.builtIn,
		};
	});
	// Declared first so consecutive same-group options render under one header.
	return options.sort((a, b) => (a.group === b.group ? 0 : a.group === DOMAIN_GROUP.declared ? -1 : 1));
}

async function getStepList(): Promise<StepListResponse> {
	const { steps, domains, concerns, pending } = registry();
	if (steps && domains && concerns) {
		// Another bundle of this page asked the site; this one is told the same answer, and reads it for itself.
		readDeclarations(concerns, domains);
		return { steps, domains, concerns };
	}
	if (pending) return pending;
	const discovery = discover();
	registry().pending = discovery;
	try {
		return await discovery;
	} finally {
		registry().pending = null;
	}
}

/** Hydration data embedded in the HTML by monitor-stepper at endFeature. The run's events ride inside `rpcCache`, under
 *  the `getEvents` response the client would otherwise have fetched. */
export interface ShuHydration {
	rpcCache?: Record<string, unknown>;
	viewHash?: string;
	/** The credential this reader acts under, where the deployment declared one, and the actions it holds. */
	session?: { token: string; allowedAction: string[] };
}

// The page boots ONCE, but its modules load once PER BUNDLE (the app, the polymorphic view, an actions-bar extension each carry
// their own copy of this module). A module-level variable here is then a copy per bundle, and only the app's copy ever
// read the payload: an extension asking for the session credential saw none and refused what the page may do. The one
// payload is pinned on globalThis, the same way the quads snapshot is, so every bundle reads the same boot.
const HYDRATION_KEY = "__SHU_HYDRATION__";
const heldHydration = (): { data: ShuHydration | null } => {
	const g = globalThis as unknown as Record<string, { data: ShuHydration | null } | undefined>;
	return (g[HYDRATION_KEY] ??= { data: null });
};

/** Parse the embedded hydration and drop the text it was parsed from: the element holds the whole run — every event —
 *  as one string, which would sit in the DOM for the life of the page beside the objects parsed out of it. Read once
 *  (`hydrateFromDom`, at boot), so nothing reads it again. */
function readHydration(): ShuHydration | null {
	const el = document.getElementById("shu-hydration");
	if (!el?.textContent) return null;
	const text = el.textContent;
	el.textContent = "";
	try {
		return JSON.parse(text) as ShuHydration;
	} catch (err) {
		failFastOrLog("[shu] Failed to parse hydration data:", err);
		return null;
	}
}

/** Apply hydrated data immediately (before any RPC). */
export function hydrateFromDom(): void {
	heldHydration().data = readHydration();
	const booted = heldHydration().data;
	if (booted?.rpcCache) setRpcCache(booted.rpcCache);
}

/**
 * True if the page was loaded from an offline HTML file. The hydration script
 * is present in BOTH live and standalone (live serves `{}` so SSR shape is
 * stable). The distinguishing signal is presence of `rpcCache` — saves always
 * embed at least `rpcCache: {}` (see monitor-stepper.writeStandaloneReport),
 * the live serve never does.
 */
export function isStandaloneMode(): boolean {
	return heldHydration().data !== null && heldHydration().data?.rpcCache !== undefined;
}

/** Get the view hash embedded at export time (offline mode). */
export function getHydratedViewHash(): string {
	return heldHydration().data?.viewHash ?? "";
}

/**
 * What the site declares is one thing per page, and the reading built from it is each bundle's own: the metadata, the
 * edge index, the role nouns. A bundle reads once. Reading again would rebuild that metadata from the declarations
 * alone, discarding what a view merged onto it from the site itself, so a bundle already told is left as it is.
 */
let read = false;
function readDeclarations(concerns: TConcernCatalog, domains: Record<string, DomainInfo>): void {
	if (read) return;
	read = true;
	setConcernCatalog(concerns, domains);
}

async function discover(): Promise<StepListResponse> {
	const result = await conduit().follow<unknown>({ method: "step.list" }, "rpc-registry: discover available steps");
	const parsed: StepListResponse = StepListResponseSchema.parse(result);
	const { steps, domains, concerns } = parsed;
	readDeclarations(concerns, domains);
	for (const [label, concern] of Object.entries(concerns.persisted)) {
		if (/^\s*\[.*\]\s*$/.test(concern.label)) throw new Error(`step.list concern ${label} has stringified-array label: ${concern.label}`);
	}
	registry().steps = steps;
	registry().domains = domains;
	registry().concerns = concerns;
	return { steps, domains, concerns };
}

/** Look up a registered step by either its friendly name (e.g. `"graphQuery"`) or its full `Stepper-method` form. The name is the wire contract — resolution, and any "unknown step" outcome, happen at runtime against the loaded registry. */
export function findStep(name: string): StepDescriptor | undefined {
	return registry().steps?.find((s) => s.stepName === name || s.method === name);
}

/** Resolve a friendly name (e.g. `"graphQuery"`) to the loaded stepper's full method (e.g. `"GraphStepper-graphQuery"`). A name no loaded stepper provides fails fast at runtime. */
export function requireStep(name: string): string {
	const step = findStep(name);
	if (step) return step.method;
	if (isStandaloneMode()) return findCachedMethod(name) ?? name;
	throw new Error(`Step "${name}" not found in registry. Call getAvailableSteps() first.`);
}

/**
 * Find steps relevant to the current type label.
 * Matches by: param domain, graph-query domain,
 * persisted-type domain, or step pattern containing the label name.
 */
export function stepsForContext(label: string): StepDescriptor[] {
	const { steps, domains } = registry();
	if (!steps || !domains) return [];
	const lc = label.toLowerCase();
	// Find domain keys that relate to this label
	const contextDomains = new Set<string>();
	for (const [key, info] of Object.entries(domains)) {
		if (info.persistedAs === label) contextDomains.add(key);
		if (key.toLowerCase().includes(lc)) contextDomains.add(key);
	}
	return steps.filter((step) => {
		// Match by param domain
		if (step.paramDomains && Object.values(step.paramDomains).some((domain) => contextDomains.has(domain))) return true;
		// Match by step pattern containing the label (e.g., "show contacts", "get contact")
		if (step.pattern.toLowerCase().includes(lc)) return true;
		return false;
	});
}
