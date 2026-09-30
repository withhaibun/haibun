import { HYDRATION_ID } from "./consts.js";
import { reads, acts, conduit, isServerUnreachable, type TLink } from "./hypermedia.js";
import { getConcernCatalog, cachedConcernCatalog, setConcernCatalog } from "./rels-cache.js";
import { pagePinned } from "./page-pinned.js";
import { deviceStore, type TCachePayload } from "./client-cache/index.js";
import { reportFailure, reportToRun } from "./client-log.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { STEPS_CHANGED } from "@haibun/core/schema/protocol.js";
import { EVERY_DEFINITION, SHOW_STEPS_METHOD, readShownSteps, type TDomainDiscoveryInfo, type TStepDefinition, type TStepDefinitions } from "@haibun/core/lib/step-discovery.js";
import { eventStream } from "./event-stream.js";
import { domainParts } from "@haibun/core/lib/domains.js";
import { capabilityAllows } from "@haibun/core/lib/actions.js";

/** The source the registry reports under. */
const REGISTRY = "rpc-registry";

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
const DOMAIN_GROUP = { declared: "Declared", builtIn: "Built-in" } as const;

type TStepList = Pick<TStepDefinitions, "steps" | "domains" | "concerns">;

// What the server said it offers, pinned to the page rather than cached per bundle: a page is more than one bundle, and a
// panel a deployment adds requests the same server as the app. Stored per bundle, a panel would discover the server again, and
// would not know what a step it calls requires. The catalog the server declares is not cached here: rels-cache owns it,
// pinned the same way, so one thing has one home.
const REGISTRY_KEY = "__SHU_STEP_REGISTRY__";
type TRegistry = {
	steps: TStepDefinition[] | null;
	byName: Map<string, TStepDefinition> | null;
	domains: Record<string, TDomainDiscoveryInfo> | null;
	pending: Promise<TStepList> | null;
	/** Stops reading the steps again on actuality's stream; null until the page first reads them. */
	unfollow: (() => void) | null;
	/** A read again waits for the read under way to end. */
	rereadQueued: boolean;
	/** What is told each time the page has read actuality's steps again. */
	listeners: Set<() => Promise<void> | void>;
};
const registry = (): TRegistry =>
	pagePinned(
		REGISTRY_KEY,
		(): TRegistry => ({ steps: null, byName: null, domains: null, pending: null, unfollow: null, rereadQueued: false, listeners: new Set() }),
		(r) => r.unfollow?.(),
	);

// Both go through the step list even when the page already has it, because the response is only half of what asking for
// it does: the other half is this bundle reading what the server declares, which is what its views draw by.
export async function getAvailableSteps(): Promise<TStepDefinition[]> {
	return (await getStepList()).steps;
}

export async function getAvailableDomains(): Promise<Record<string, TDomainDiscoveryInfo>> {
	return (await getStepList()).domains;
}

/**
 * Build selectable domain options. Persisted domains (those with persistedAs) are
 * selectable. Partitions on `concern.declared` into "Declared" (runtime
 * `set of {domain} by …`) vs "Built-in" (compiled stepper) groups, declared
 * first so feature-authored types surface above the system ones.
 */
export function buildDomainOptions(domains: Record<string, TDomainDiscoveryInfo>): DomainOption[] {
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

async function getStepList(): Promise<TStepList> {
	const r = registry();
	const concerns = cachedConcernCatalog();
	if (r.steps && r.domains && concerns) {
		// Another bundle of this page requested the server; this one receives the same response, and reads it for itself
		// (a no-op in a bundle that already has: setConcernCatalog derives once per catalog).
		setConcernCatalog(concerns, r.domains);
		return { steps: r.steps, domains: r.domains, concerns };
	}
	return r.pending ?? (await readSteps(r));
}

/** Read what actuality declares. The page holds what it read before until this read answers, so a step the page looks up
 *  while the read is under way is found. */
async function readSteps(r: TRegistry): Promise<TStepList> {
	const discovery = discover();
	r.pending = discovery;
	try {
		return await discovery;
	} finally {
		r.pending = null;
	}
}

/** What a record of a run carries in its own page: the run, what its views showed, and the address it opens at. */
interface ShuHydration {
	/** What a view showed, by the step that produces it. A view whose products cannot be read from actuality is given
	 *  what it showed when the record was written, rather than asking a server that is not there. */
	viewProducts?: Record<string, unknown>;
	/** The address this run opens at: the type its query column was showing, which the records of the run don't state. Which
	 *  views were open it never names, since the page reads those from the records it carries. */
	viewHash?: string;
	/** The actuality this page carries, for a page without a server: filled into the client cache at boot. */
	cache?: TCachePayload;
	/** What this deployment set for the page, written by the step that serves it. */
	settings?: TDeploymentSettings;
}

/**
 * The timings the page applies, as the deployment sets them. A reader waits out both, so a deployment recording fast
 * runs sets them low, and one watching a long-running system keeps the values the product carries.
 */
export type TDeploymentSettings = {
	/** How long after the stream breaks the page opens it again. */
	streamReconnectAfterMs?: number;
	/** The timeout on a request the page awaits. */
	responseTimeoutMs?: number;
	/** What every reader holds here without presenting anything, as the web server declares it. */
	allowedWithoutDelegation?: string[];
	/** Whether anything here verifies a delegation, so the page knows to read what was delegated to its key: a key's
	 *  proof sent where the deployment couldn't check it is refused. */
	verifiesDelegations?: boolean;
	/** The origin of a page that embeds shu in a frame and posts it the page the reader is on. */
	embedderOrigin?: string;
	/** The rounds of tool calls an ask starts with, before the reader chooses. */
	askToolLimit?: number;
};

// The page boots ONCE, but its modules load once PER BUNDLE (the app, the polymorphic view, an actions-bar extension
// each carry their own copy of this module). The one payload is pinned to the page so every bundle reads the same
// boot: an extension reading a per-bundle copy would see an empty rpcCache and refetch what the export embedded.
const HYDRATION_KEY = "__SHU_HYDRATION__";
const cachedHydration = (): { data: ShuHydration | null } => pagePinned(HYDRATION_KEY, () => ({ data: null }));

/** Parse the embedded hydration and drop the text it was parsed from: the element caches the whole run: every event:
 *  as one string, which would sit in the DOM for the life of the page beside the objects parsed out of it. Read once
 *  (`hydrateFromDom`, at boot), so a caller doesn't read it again. */
function readHydration(): ShuHydration | null {
	const el = document.getElementById(HYDRATION_ID);
	if (!el?.textContent) return null;
	const text = el.textContent;
	el.textContent = "";
	try {
		return JSON.parse(text) as ShuHydration;
	} catch (err) {
		reportFailure(REGISTRY, "actuality the page carries isn't JSON", err);
		return null;
	}
}

/** Apply hydrated data immediately (before any RPC). */
export function hydrateFromDom(): void {
	cachedHydration().data = readHydration();
}

/** The address a carried run opens at, or "" for a page with a server. */
export function getHydratedViewHash(): string {
	return cachedHydration().data?.viewHash ?? "";
}

/** What this page carries of a view's products, by the step that produces them; undefined on a page with a server. */
export function carriedProducts(method: string): unknown | undefined {
	return cachedHydration().data?.viewProducts?.[method];
}

/**
 * True when this page carries its own run, which is what a record of a run is: it doesn't have a server behind it, so every
 * read is answered from what the page holds. The hydration script is present either way (a live serve carries an empty
 * one so the shape is stable); a carried run is the signal, since a live serve never has one.
 */
export function isOffline(): boolean {
	return cachedHydration().data?.cache !== undefined;
}

/** What every reader holds here without presenting anything: empty, where the page was served without stating it. */
export function deploymentAllowedWithoutDelegation(): string[] {
	return cachedHydration().data?.settings?.allowedWithoutDelegation ?? [];
}

/** The rounds of tool calls an ask starts with, as this deployment sets them, or undefined where it didn't set one. */
export function deploymentAskToolLimit(): number | undefined {
	return cachedHydration().data?.settings?.askToolLimit;
}

/** The origin of the page this deployment lets embed shu, or undefined where it doesn't let one. */
export function deploymentEmbedderOrigin(): string | undefined {
	return cachedHydration().data?.settings?.embedderOrigin;
}

/** Whether this deployment verifies a delegation: false, where the page was served without stating it. */
export function deploymentVerifiesDelegations(): boolean {
	return cachedHydration().data?.settings?.verifiesDelegations === true;
}

/** A timing this deployment set, in milliseconds, or undefined where it didn't set one. A value the page cannot apply is a
 *  deployment stating something it does not mean, so it is refused rather than replaced with the product's own. */
export function deploymentMs(name: "streamReconnectAfterMs" | "responseTimeoutMs"): number | undefined {
	const set = cachedHydration().data?.settings?.[name];
	if (set === undefined) return undefined;
	if (typeof set !== "number" || !Number.isFinite(set) || set <= 0)
		throw new Error(`${name}: a deployment sets a count of milliseconds above zero, and this page was served ${JSON.stringify(set)}`);
	return set;
}

/**
 * The timeout on a request the page awaits, after which the server is reported unreachable.
 *
 * A server that accepts a request without responding leaves the view that issued it without a result or an error, so
 * the read never fails and never falls back to the device store. The timeout converts that into a reported failure.
 *
 * Calibrated against measured query latency. Over a corpus of eight thousand messages the consumer's engine answers a
 * page read in 10ms mean and 64ms at the 95th percentile; its own benchmark bounds queries at 200ms mean and 600ms at
 * the 95th; the slowest query measured in either repository is 727ms; and the clustered graph read at page load
 * answers in 151ms. Twenty seconds is 27 times the slowest measured query, and three times the 95th percentile
 * extrapolated linearly to a corpus a hundredfold larger. A deployment on slower storage raises it.
 */
export const RESPONSE_TIMEOUT_MS = 20_000;

/** The timeout this page applies, as the deployment sets it. */
export function responseTimeoutMs(): number {
	return deploymentMs("responseTimeoutMs") ?? RESPONSE_TIMEOUT_MS;
}

/** The actuality this page carries, when it carries one. */
export function hydratedCache(): TCachePayload | undefined {
	return cachedHydration().data?.cache;
}

/** Where the registry the page runs on came from: the server, or the device's copy of it (when the server did not respond),
 *  and when that copy was cached. Pinned to the page like the registry itself; null until the registry is known. */
type TRegistryOrigin = { from: "server" | "device"; savedAt?: number };
const ORIGIN_KEY = "__SHU_STEP_REGISTRY_ORIGIN__";
const origin = (): { value: TRegistryOrigin | null } => pagePinned(ORIGIN_KEY, () => ({ value: null }));
export function registryOrigin(): TRegistryOrigin | null {
	return origin().value;
}

/** Be told each time the page has read actuality's steps again. Returns the unsubscribe. */
export function onStepsChanged(listener: () => Promise<void> | void): () => void {
	const { listeners } = registry();
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * The page reads actuality's steps again each time actuality signals they changed, and each time the stream opens after the
 * page's first read began, since a change actuality signals while the stream is closed doesn't reach a page. The page
 * subscribes as its first read begins. A stream that is open then is one that read follows, so the stream's call at
 * subscription doesn't add a read.
 */
function followRun(r: TRegistry): () => void {
	const stream = eventStream();
	const stopSignals = stream.subscribe(
		() => readAgain(r),
		(event) => event.kind === "control" && event.signal === STEPS_CHANGED,
	);
	let subscribed = false;
	const stopOpenings = stream.opened(() => {
		if (subscribed) readAgain(r);
	});
	subscribed = true;
	return () => {
		stopSignals();
		stopOpenings();
	};
}

/** Read actuality's steps again once the read under way ends, since that read may have begun before the change, then tell
 *  the listeners. Signals that arrive before the read again begins don't add a read. */
function readAgain(r: TRegistry): void {
	if (r.rereadQueued) return;
	r.rereadQueued = true;
	void (r.pending ?? Promise.resolve())
		.catch(() => undefined)
		.then(async () => {
			r.rereadQueued = false;
			await (r.pending ?? readSteps(r));
			await Promise.all([...r.listeners].map(async (listener) => listener()));
		})
		// A server that doesn't answer leaves the page on the steps it holds, as every read does; any other failure is a fault.
		.catch((err) => (isServerUnreachable(err) ? undefined : reportFailure(REGISTRY, "actuality's steps were not read again", err)));
}

/** Ask the server what it offers this page. Its response is cached on the device; when the server does not respond, the
 *  device's copy is the registry the page runs on (and reports it), so a page without a server still holds the server's
 *  declarations. A server that responds with a refusal is answered, not the copy: what the page may no longer read is
 *  not read from the device instead. Where the page doesn't have either, the request fails as it did. */
async function discover(): Promise<TStepList> {
	const r = registry();
	r.unfollow ??= followRun(r);
	let parsed: TStepDefinitions;
	try {
		parsed = readShownSteps(
			await conduit().follow<Record<string, unknown>>(reads(SHOW_STEPS_METHOD, EVERY_DEFINITION), "rpc-registry: discover available steps"),
			EVERY_DEFINITION.detail,
		);
		origin().value = { from: "server" };
		void deviceStore()
			.setRegistry(parsed)
			.catch((err) => reportFailure(REGISTRY, "the registry was not cached on the device", err));
	} catch (err) {
		if (!isServerUnreachable(err)) throw err;
		const cached = await deviceStore()
			.registry()
			.catch(() => undefined);
		if (!cached) throw err;
		parsed = readShownSteps(cached.response, EVERY_DEFINITION.detail);
		origin().value = { from: "device", savedAt: cached.savedAt };
		reportToRun("warn", REGISTRY, `the server did not respond; the registry cached on this device (${new Date(cached.savedAt).toISOString()}) is in use: ${errorDetail(err)}`);
	}
	const { steps, domains, concerns } = parsed;
	setConcernCatalog(concerns, domains);
	for (const [label, concern] of Object.entries(concerns.persisted)) {
		if (/^\s*\[.*\]\s*$/.test(concern.label)) throw new Error(`${SHOW_STEPS_METHOD} concern ${label} has stringified-array label: ${concern.label}`);
	}
	r.steps = steps;
	r.domains = domains;
	// Looked up on every call the page makes, so the registry is indexed once under both names a step responds to. Two
	// steppers may offer one step name, and the one that is not a fallback answers to it (`TStepDefinition.fallback`);
	// where both are alike, the first the site listed answers. A method names its stepper, so it names one step.
	const byName = new Map<string, TStepDefinition>();
	const answers = (held: TStepDefinition | undefined, step: TStepDefinition): boolean => held === undefined || (held.fallback === true && step.fallback !== true);
	for (const step of steps) {
		if (answers(byName.get(step.stepName), step)) byName.set(step.stepName, step);
		if (!byName.has(step.method)) byName.set(step.method, step);
	}
	r.byName = byName;
	return { steps, domains, concerns };
}

/**
 * A link to a step named at run time, asking what that step declares itself to answer.
 *
 * A caller that chooses a method as it runs: a person picking a step, a panel following an affordance it was offered
 * cannot state what the step is, so the step states it: the registry the page loaded carries each step's own
 * declaration. A method the loaded steppers don't provide asks actuality to act, which is what naming an unknown step is.
 */
export function linkTo(method: string, params?: Record<string, unknown>, summary?: string): TLink {
	return findStep(method)?.read === true ? reads(method, params, summary) : acts(method, params, summary);
}

/** Look up a registered step by either its friendly name (e.g. `"graphQuery"`) or its full `Stepper-method` form. The name is the wire contract, resolution, and any "unknown step" outcome, happen at runtime against the loaded registry. */
export function findStep(name: string): TStepDefinition | undefined {
	return registry().byName?.get(name);
}

/** A domain as actuality declares it, by its key. */
export function findDomain(key: string): TDomainDiscoveryInfo | undefined {
	return registry().domains?.[key];
}

/** The steps that take a domain and the steps that return it, the domain named by its key or by the type it persists
 *  as. A step taking a union takes each of its parts. */
export function stepsJoining(name: string): { taking: TStepDefinition[]; returning: TStepDefinition[] } {
	const { steps, domains } = registry();
	if (!steps || !domains) throw new Error(`the steps joining ${name} are read after actuality's steps: call getAvailableSteps() first`);
	const keys = new Set(Object.entries(domains).flatMap(([key, info]) => (key === name || info.persistedAs === name ? [key] : [])));
	return {
		taking: steps.filter((step) => Object.values(step.paramDomains).some((domain) => domainParts(domain).some((part) => keys.has(part)))),
		returning: steps.filter((step) => step.productsDomain !== undefined && keys.has(step.productsDomain)),
	};
}

/** The steps this page may call that an action allows: each step whose required action the action allows, by the one
 *  reading every gate on a call uses. */
export function stepsAllowedBy(action: string): TStepDefinition[] {
	const { steps } = registry();
	if (!steps) throw new Error(`the steps ${action} allows are read after actuality's steps: call getAvailableSteps() first`);
	return steps.filter((step) => capabilityAllows(action, step.capability));
}

/** Resolve a friendly name (e.g. `"graphQuery"`) to the loaded stepper's full method (e.g. `"GraphStepper-graphQuery"`). A name the loaded steppers don't provide fails fast at runtime. */
export function requireStep(name: string): string {
	const step = findStep(name);
	if (step) return step.method;
	throw new Error(`Step "${name}" not found in registry. Call getAvailableSteps() first.`);
}

/**
 * Find steps relevant to the current type label.
 * Matches by: param domain, graph-query domain,
 * persisted-type domain, or step pattern containing the label name.
 */
export function stepsForContext(label: string): TStepDefinition[] {
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
		if (Object.values(step.paramDomains).some((domain) => contextDomains.has(domain))) return true;
		// Match by step pattern containing the label (e.g., "show contacts", "get contact")
		if (step.pattern.toLowerCase().includes(lc)) return true;
		return false;
	});
}
