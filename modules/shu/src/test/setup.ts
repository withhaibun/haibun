/**
 * `setupShuTest`: the single way every shu test installs its services. One
 * call inside `beforeEach` (or once at suite level) installs a `TConduit` and
 * an event stream, returns handles for the test to drive scripted events
 * and inspect dispatch params, and runs cleanup on teardown.
 *
 * Tests pass a `dispatch` function that returns wire results per
 * `(method, params)`; throwing inside it is the loud-failure signal for an unconfigured
 * fixture, and the throw surfaces verbatim through `conduit()`
 * call sites. Tests `emit` events to drive lifecycle/log subscribers.
 *
 * Every test sets up the same way, without setup by side effect; omitting
 * the call makes the first `conduit()` or `pageEventStream()` throw a precise
 * "the page doesn't hold a conduit" / "the page doesn't hold an event stream" error naming
 * what was missed.
 */

import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import { actualityAt } from "@haibun/core/lib/transport/adapters/rpc-call.js";
import { HYDRATION_ID } from "../domains/elements.js";
import { RESPONSE_TIMEOUT_MS, type TDeploymentSettings } from "../domains/hydration.js";
import { installAuthority, installConduit, installHydration, installCarriedEventStream, pagePreferences } from "../page/root.js";
import { readHydration } from "../page/pipelines/hydrate.js";
import type { TConduit, TEvent, TClientLogLevel, TClock } from "../page/ports.js";
import type { TLink, TRepresentation, TStreamChunk } from "../page/domains/links.js";

// ─── The conduit a test installs ─────────────────────────────────────────────

/** A test's responses, by `(method, params)`, given the link followed, for a case that checks what a call requests. A throw inside it signals that a fixture for this call doesn't exist: `TestConduit` surfaces the throw so a test fails loudly, naming the method a fixture didn't serve. */
export type TDispatch = (method: string, params: Record<string, unknown>, link: TLink) => unknown | Promise<unknown>;

/** What a stream rejects with once its caller aborts it, as the fetch that carries one rejects. */
export const STREAM_ABORTED = "the stream was aborted";

/** A stream a case drives, one form of a dispatch's response to a streamed call: the seqPath actuality announces, or null where
 *  it doesn't announce one, and `run`, which sends chunks until it resolves, given the caller's abort signal. */
export class DrivenStream {
	constructor(
		readonly seqPath: number[] | null,
		readonly run: (send: (chunk: TStreamChunk) => void, signal?: AbortSignal) => Promise<void>,
	) {}
}

/** A `TConduit` that responds from a function a test supplies, so the code under test doesn't detect that it isn't calling a server. */
export class TestConduit implements TConduit {
	constructor(private readonly dispatch: TDispatch) {}

	async follow<T = TRepresentation>(link: TLink, _why: string): Promise<T> {
		const result = await this.dispatch(link.method, link.params ?? {}, link);
		return result as T;
	}

	/** A plain response is the chunk, or the chunks, the stream sends in order, announced at seqPath [0]; a `DrivenStream`
	 *  is sent as its case drives it. Either is announced once the dispatch responds, before a chunk arrives. */
	async followStream(
		link: TLink,
		onChunk: (chunk: TStreamChunk) => void,
		opts: { why: string; signal?: AbortSignal; onStart?: (seqPath: number[]) => void },
	): Promise<{ seqPath: number[] }> {
		const answer = await this.dispatch(link.method, link.params ?? {}, link);
		const stream = answer instanceof DrivenStream ? answer : new DrivenStream([0], async (send) => ((Array.isArray(answer) ? answer : [answer]) as TStreamChunk[]).forEach(send));
		if (stream.seqPath) opts.onStart?.(stream.seqPath);
		const { signal } = opts;
		// A stream its caller aborted, or that ended, doesn't send a chunk after it.
		let open = true;
		const send = (chunk: TStreamChunk): void => {
			if (!open) return;
			// A chunk carrying an error ends the stream, as it ends one from a service: a caller reads the same failure
			// whichever conduit is installed.
			if (chunk?.error) {
				open = false;
				throw new Error(String(chunk.error));
			}
			onChunk(chunk);
		};
		let abort = (): void => undefined;
		const aborted = new Promise<never>((_, reject) => {
			abort = () => {
				open = false;
				reject(new Error(STREAM_ABORTED));
			};
		});
		if (signal?.aborted) abort();
		else signal?.addEventListener("abort", abort, { once: true });
		try {
			const running = stream.run(send, signal);
			// What a stream does after its caller aborted it doesn't reach the caller.
			void Promise.allSettled([running]);
			await Promise.race([running, aborted]);
		} finally {
			open = false;
			signal?.removeEventListener("abort", abort);
		}
		return { seqPath: stream.seqPath ?? [] };
	}

	group<T>(_why: string, fn: (g: TConduit) => Promise<T>): Promise<T> {
		return fn(this);
	}
}

import { CarriedEventStream } from "../page/adapters/carried-event-stream.js";
import { endPage } from "../page/adapters/page-held.js";
import { CACHE_SHAPE } from "../page/client-cache/ports.js";
import { installMemoryDeviceStore } from "../page/client-cache/root.js";
import { hydrateFromDom } from "../page/controllers/hydration-controller.js";
import { onStepsChanged } from "../page/controllers/registry-controller.js";
import { CLIENT_LOG_ACTION, CLIENT_LOG_METHOD } from "../page/domains/page-calls.js";
import { authorityPort, openPageAuthority, type TPageAuthority } from "../page/authority/controllers/page-authority-controller.js";
import type { TDelegations } from "@haibun/core/lib/domains/authority-types.js";
import {
	SHOW_STEP_DEFINITIONS_METHOD,
	StepDescriptorSchema,
	type TStepDefinition,
	type TStepDefinitions,
	readStepDefinitions,
	stepDefinition,
} from "@haibun/core/lib/step-discovery.js";
import { requiredAction, type TStepReads } from "@haibun/core/lib/domains/actions.js";
import { steppersOf } from "@haibun/core/lib/steps/pipelines/discover-steps.js";
import { ARTIFACTS_ROUTE } from "@haibun/core/lib/domains/run-artifact.js";
import { buildConcernCatalog, counted, type TConcernCatalog } from "@haibun/core/lib/domains/hypermedia.js";
import { Access, LinkRelations, type TDomainDefinition, type TEdgeDef, type TRel, type TAnnotationView } from "@haibun/core/lib/domains/resources.js";
import { fromJsonText } from "@haibun/core/lib/domains/json-text.js";
import { z } from "zod";
import { STEPS_CHANGED } from "@haibun/core/lib/domains/protocol.js";
import { PREFERENCES_COOKIE_PREFIX } from "../page/adapters/prefs-cookie.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";

type TShuTestConfig = {
	/** Optional dispatch for in-test RPCs. Default throws on every call, naming the unconfigured method, tests opt in by supplying a function that returns wire results for the methods they exercise. */
	dispatch?: TDispatch;
	/** What actuality returns for a read of one of its artifacts, given the read as the page sent it: an empty image unless a test specifies otherwise. */
	artifact?: (url: string, init?: RequestInit) => Response;
};

/** Serve a view's reads of actuality's artifacts as actuality's artifact route does, and show what it read at an object URL
 *  a test page can hold, until the returned function restores both. */
function servingArtifacts(answer: (url: string, init?: RequestInit) => Response): () => void {
	const through = globalThis.fetch;
	const objectUrl = URL.createObjectURL;
	globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
		String(url).startsWith(`${ARTIFACTS_ROUTE}/`) ? Promise.resolve(answer(String(url), init)) : through(url, init)) as typeof fetch;
	URL.createObjectURL = () => "blob:artifact";
	return () => {
		globalThis.fetch = through;
		URL.createObjectURL = objectUrl;
	};
}

export type TShuTestHandle = {
	/** Drive a scripted event into the installed `TEventStream`. Components subscribed via `pageEventStream()` see it as if it had arrived over SSE. */
	emit: (event: TEvent) => void;
	/** Tear down both services. Call from `afterEach` (or rely on the next `beforeEach`'s `setupShuTest` overwriting them: both are valid). */
	teardown: () => void;
	/** The `TestConduit` instance installed under `conduit()`. Exposed for assertions that need to swap the dispatch mid-test or read the instance identity. */
	conduit: TestConduit;
	/** The `CarriedEventStream` instance installed under `pageEventStream()`. Exposed for assertions that need its `totalRecorded()` or to inspect identity. */
	eventStream: CarriedEventStream;
};

/** Signal on actuality's stream that its steps changed, as actuality does when a feature declares a step; `n` distinguishes one
 *  signal from another. */
export const stepsChanged = (handle: TShuTestHandle, n: number): void =>
	handle.emit({ id: `${STEPS_CHANGED}-${n}`, timestamp: Date.now(), kind: "control", level: "debug", signal: STEPS_CHANGED });

/** Resolves once the page has read actuality's steps again, and what that read returned has settled. */
export const stepsReadAgain = (): Promise<void> =>
	new Promise((resolve) => {
		const stop = onStepsChanged(() => {
			stop();
			setTimeout(resolve, 0);
		});
	});

/**
 * A persisted type as a stepper defines it: its label, the selector its domain is declared under (the label in lower case
 * unless given), its description, each property beside the id and the time every persisted type records by the rel it
 * maps to, each edge, and whether a feature declared it at run time. Core's
 * `buildConcernCatalog(mapDefinitionsToDomains([...]))` makes the catalog a run states from it.
 */
export function persistedTypeDefinition(
	label: string,
	{
		selector = label.toLowerCase(),
		description = `the ${label} records`,
		properties = {},
		edges = {},
		declared = false,
		subClassOf,
	}: { selector?: string; description?: string; properties?: Record<string, TRel>; edges?: Record<string, TEdgeDef>; declared?: boolean; subClassOf?: string } = {},
): TDomainDefinition {
	const schema = z.object({ id: z.string(), generatedAtTime: z.string(), ...Object.fromEntries(Object.keys(properties).map((field) => [field, z.string()])) });
	return {
		selectors: [selector],
		schema: fromJsonText(schema),
		description,
		topology: {
			persistedAs: label,
			id: "id",
			accessLevel: Access.private,
			properties: { id: LinkRelations.IDENTIFIER.rel, ...properties },
			edges,
			...(subClassOf === undefined ? {} : { subClassOf }),
		},
		// A feature's `set of {domain} by …` declaration marks what it registers this way.
		...(declared ? { ui: { declared: true } } : {}),
	};
}

/** The steps given, the domains given, and the types the catalog given declares, as the show steps step returns them
 *  when they are all a run declares. */
export function stepsShown(
	steps: Array<
		{
			method: string;
			stepperName: string;
			stepName: string;
			pattern: string;
			description?: string;
			fallback?: boolean;
			answersTheTurn?: boolean;
			/** Whether the page may call the step, which it may where this isn't stated. */
			callable?: boolean;
			paramDomains?: Record<string, string>;
			productsDomain?: string;
			recordData?: Record<string, string>;
			inputSchema?: TStepDefinition["inputSchema"];
			outputSchema?: Record<string, unknown>;
		} & TStepReads
	>,
	domains: TStepDefinitions["domains"] = {},
	concerns: TConcernCatalog = buildConcernCatalog({}),
): TStepDefinitions {
	// A step that doesn't state its input schema takes an empty object, and one that doesn't state its description is described as a test's.
	const described = steps.map(({ callable: _callable, ...step }) =>
		StepDescriptorSchema.parse({
			inputSchema: { type: "object" as const, properties: {}, required: [] },
			description: TEST_STEP,
			...step,
			// Each step requires what a step of actuality would: what it declares, a read at its level for a read, and otherwise its name.
			capability: requiredAction(step.stepperName, step.stepName, step),
			stepperDescription: `the steps of ${step.stepperName}`,
			paramDomains: step.paramDomains ?? {},
			read: step.read === true,
			fallback: step.fallback === true,
			answersTheTurn: step.answersTheTurn === true,
		}),
	);
	const definitions = described.map((step, at) => stepDefinition(step, steps[at]?.callable !== false));
	return readStepDefinitions({ steppers: steppersOf(described), steps: definitions, domains, concerns, predicates: [], ...counted(described.length) });
}

/** A dispatch over a run that declares what `shown` returns each time the page reads its steps; any other call throws. */
export const declaringSteps =
	(shown: () => TStepDefinitions): TDispatch =>
	(method) => {
		if (method === SHOW_STEP_DEFINITIONS_METHOD) return shown();
		throw new Error(`unexpected ${method}`);
	};

/** The two steps the entity surface calls, as the read of the step definitions returns them: the fixture every entity test installs. */
export const ENTITY_STEP_LIST = stepsShown([
	{ method: "GraphStepper-getIndividualWithEdges", stepperName: "GraphStepper", stepName: "getIndividualWithEdges", pattern: "get vertex {label} {id}" },
	{ method: "ResourcesStepper-annotations", stepperName: "ResourcesStepper", stepName: "annotations", pattern: "get annotations for {label} {id}" },
]);

/** A dispatch over the entity surface: the read of the step definitions returns {@link ENTITY_STEP_LIST}, the two entity steps route
 *  to the given responders (annotations defaults to an empty list), and anything else throws: the loud-failure signal. */
/** The notes anchored in a record, as the annotations step returns them. */
export const annotationList = (annotations: TAnnotationView[]): { annotations: TAnnotationView[]; total: number } => ({ annotations, total: annotations.length });

export function makeEntityDispatch(over: { entity: (params: Record<string, unknown>) => unknown; annotations?: () => unknown }): TDispatch {
	return (method, params) => {
		if (method === SHOW_STEP_DEFINITIONS_METHOD) return ENTITY_STEP_LIST;
		if (method === "GraphStepper-getIndividualWithEdges") return over.entity(params);
		if (method === "ResourcesStepper-annotations") return over.annotations ? over.annotations() : annotationList([]);
		throw new Error(`unexpected ${method}`);
	};
}

/** A report the page sent actuality through the monitor's client-log step. */
export type TReportedToRun = { level: TClientLogLevel; source: string; message: string; attributes?: Record<string, unknown> };

/** Open the page's authority as a page actuality lets report to it: it holds what reporting requires, beside
 *  `withoutDelegation` and what `read` delegates. A test that opens one needs an IndexedDB for the page's key. */
export const openReportingPage = (read?: () => Promise<TDelegations>, withoutDelegation: string[] = []): Promise<TPageAuthority> =>
	openPageAuthority(read, [CLIENT_LOG_ACTION, ...withoutDelegation]);

/** A dispatch that receives the page's reports to actuality as the monitor's client-log step does, holding each in `reported`;
 *  any other call throws. */
export function reportingTo(reported: TReportedToRun[]): TDispatch {
	return (method, params) => {
		if (method !== CLIENT_LOG_METHOD) throw new Error(`unexpected ${method}`);
		reported.push(params.event as TReportedToRun);
		return {};
	};
}

/** jsdom doesn't implement media queries, so a component that queries the viewport (the strip queries whether it is
 *  narrow or portrait before it lays panes out) throws only there. Install the query API the browser always has, where
 *  every query fails to match: a jsdom window doesn't have an orientation or a width on which a query matches.
 *  `setupShuTest` calls this; a DOM test that doesn't install services calls it directly. */
export function installTestMediaQueries(): void {
	const w = globalThis as { matchMedia?: (q: string) => unknown };
	if (w.matchMedia) return;
	w.matchMedia = (media: string) => ({
		media,
		matches: false,
		onchange: null,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		addListener: () => undefined,
		removeListener: () => undefined,
		dispatchEvent: () => false,
	});
}

/** The actuality a test page carries. */
const CARRIED_RUN = { shape: CACHE_SHAPE, actuality: "r1", quads: [] };

/** Give the page the hydration a deployment writes, in place of any it carried. The page reads it at `hydrateFromDom`. */
export function hydrate(payload: unknown): HTMLScriptElement {
	document.getElementById(HYDRATION_ID)?.remove();
	const script = document.createElement("script");
	script.type = MEDIA_TYPE.json;
	script.id = HYDRATION_ID;
	script.textContent = JSON.stringify(payload);
	document.head.appendChild(script);
	return script;
}

/** The settings a deployment writes into a test page it serves. */
export const SERVED_SETTINGS: TDeploymentSettings = {
	responseTimeoutMs: RESPONSE_TIMEOUT_MS,
	allowedWithoutDelegation: [],
	verifiesDelegations: false,
	build: { version: "test", builtAt: "2026-01-01T00:00:00.000Z" },
};

/** Returns the settings of a test page a deployment serves, with `settings` in place of the test kit's. */
export const servedWith = (settings: Partial<TDeploymentSettings>): TDeploymentSettings => ({ ...SERVED_SETTINGS, ...settings });

/** The actuality whose records a test page reads. */
export const PAGE_ACTUALITY = crypto.randomUUID();

/** Make this page a record of a run: it carries one, so it doesn't have a server behind it. */
export function carryAnActuality(): void {
	hydrate({ actualityId: PAGE_ACTUALITY, cache: CARRIED_RUN });
	hydrateFromDom();
}

/** Make it a page the instance at `base` served, with the actualityId of the records that instance holds, and the
 *  reader's authority installed, as the page's start installs it. */
export async function serveThePageFrom(base: string): Promise<void> {
	hydrate({ actualityId: await actualityAt(base), settings: SERVED_SETTINGS });
	hydrateFromDom();
	installAuthority(authorityPort());
}

/** Make it a page a server served, with the hydration the server writes. */
export function serveThePage(): void {
	hydrate({ actualityId: PAGE_ACTUALITY, settings: SERVED_SETTINGS });
	hydrateFromDom();
}

export function setupShuTest(config: TShuTestConfig = {}): TShuTestHandle {
	installTestMediaQueries();
	clearEveryStoredField();
	const dispatch: TDispatch =
		config.dispatch ??
		((method) => {
			throw new Error(
				`setupShuTest: a dispatch for "${method}" isn't configured. Pass setupShuTest({ dispatch: (method, params) => ... }) and return a wire result for the methods this test exercises.`,
			);
		});
	const conduit = new TestConduit(dispatch);
	const eventStream = installCarriedEventStream();
	const stopServingArtifacts = servingArtifacts(config.artifact ?? (() => new Response(new Blob([], { type: MEDIA_TYPE.png }))));
	installConduit(conduit);
	installAuthority(authorityPort());
	installMemoryDeviceStore();
	serveThePage();
	return {
		emit: (event) => eventStream.emit(event),
		// A test stands in for a page: tearing it down ends the page, so what the page held is made afresh by the next.
		teardown: () => {
			stopServingArtifacts();
			eventStream.close();
			endPage();
		},
		conduit,
		eventStream,
	};
}

/** Ends the page and starts the next, with its hydration read and the reader's authority installed, as the page's start
 *  reads and installs them. A test that
 *  builds a page without `setupShuTest` starts each page here. */
export function newPage(): void {
	endPage();
	// A test without a document stands for a page without a hydration element.
	if (typeof document === "undefined") installHydration(readHydration({ take: () => undefined }));
	else hydrateFromDom();
	installAuthority(authorityPort());
}

/** Removes the stored fields of every tag, so a test starts as a reader's first page does. */
export function clearEveryStoredField(): void {
	for (const [name] of document.cookie.split("; ").map((cookie) => cookie.split("="))) {
		if (name?.startsWith(PREFERENCES_COOKIE_PREFIX)) clearStoredFields(name.slice(PREFERENCES_COOKIE_PREFIX.length));
	}
}

/** Removes every instance's stored fields of `tag`, and the writes the page holds for them, so a test starts without
 *  them. */
export function clearStoredFields(tag: string): void {
	pagePreferences().flush();
	document.cookie = `${PREFERENCES_COOKIE_PREFIX}${tag}=; path=/; max-age=0`;
}

/** Returns the messages of the errors the page reports while `fn` runs, as an error a listener or an element's connection
 *  throws, which the browser reports to the window rather than to the caller. */
export function reportedErrors(fn: () => void): string[] {
	const reported: string[] = [];
	const onError = (e: ErrorEvent): void => {
		reported.push(e.message);
		e.preventDefault();
	};
	window.addEventListener("error", onError);
	try {
		fn();
	} finally {
		window.removeEventListener("error", onError);
	}
	return reported;
}

/** Stores `fields` for the instance `key` of `tag` at once, as an element that wrote them on an earlier page did. */
export function storeFields(tag: string, key: string, fields: Record<string, unknown>): void {
	pagePreferences().write(tag, key, () => fields);
	pagePreferences().flush();
}

/** A clock a test advances: its instant moves only by `advance`, which runs each delay and frame due by then, in order. */
export function manualClock(start: number): { clock: TClock; advance(ms: number): void } {
	let now = start;
	let next = 0;
	const due = new Map<number, { at: number; fn: () => void }>();
	const hold = (at: number, fn: () => void): (() => void) => {
		const id = next++;
		due.set(id, { at, fn });
		return () => due.delete(id);
	};
	return {
		clock: { now: () => now, elapsed: () => now, after: (ms, fn) => hold(now + ms, fn), frame: (fn) => hold(now, fn) },
		advance: (ms) => {
			const until = now + ms;
			for (let first = earliest(due, until); first !== undefined; first = earliest(due, until)) {
				const [id, { at, fn }] = first;
				due.delete(id);
				now = at;
				fn();
			}
			now = until;
		},
	};
}

/** Returns the held call due earliest at or before `until`, where one is held. */
function earliest(due: Map<number, { at: number; fn: () => void }>, until: number): [number, { at: number; fn: () => void }] | undefined {
	let found: [number, { at: number; fn: () => void }] | undefined;
	for (const entry of due) if (entry[1].at <= until && (found === undefined || entry[1].at < found[1].at)) found = entry;
	return found;
}
