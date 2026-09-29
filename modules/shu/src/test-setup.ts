/**
 * `setupShuTest`: the single way every shu test installs its services. One
 * call inside `beforeEach` (or once at suite level) installs a `Conduit` and
 * an `EventStream`, returns handles for the test to drive scripted events
 * and inspect dispatch params, and runs cleanup on teardown.
 *
 * Tests pass a `dispatch` function that returns wire results per
 * `(method, params)`; throwing inside it is the loud-failure signal for an unconfigured
 * fixture, and the throw surfaces verbatim through `conduit()`
 * call sites. Tests `emit` events to drive lifecycle/log subscribers.
 *
 * Every test sets up the same way, without setup by side effect; forgetting
 * the call makes the first `conduit()` or `eventStream()` throw a precise
 * "a Conduit isn't installed" / "an EventStream isn't installed" error naming
 * what was missed.
 */

import { HYDRATION_ID } from "./consts.js";
import { setConduit, type Conduit, type TLink, type TRepresentation, type TStreamChunk } from "./hypermedia.js";

// ─── The conduit a test installs ─────────────────────────────────────────────

/** A test's answers, by `(method, params)`, given the link followed, for a case that checks what a call asks. Throwing inside it signals that a fixture for this call doesn't exist: `TestConduit` surfaces the throw so a test fails loudly, naming the method a fixture didn't answer. */
export type TDispatch = (method: string, params: Record<string, unknown>, link: TLink) => unknown | Promise<unknown>;

/** What a stream rejects with once its caller aborts it, as the fetch that carries one rejects. */
export const STREAM_ABORTED = "the stream was aborted";

/** A stream a case drives, one form a dispatch answers a streamed call with: the seqPath the run announces, or null where
 *  it doesn't announce one, and `run`, which sends chunks until it resolves, given the caller's abort signal. */
export class DrivenStream {
	constructor(
		readonly seqPath: number[] | null,
		readonly run: (send: (chunk: TStreamChunk) => void, signal?: AbortSignal) => Promise<void>,
	) {}
}

/** A `Conduit` answering from a function a test supplies, so the code under test doesn't detect that it isn't calling a server. */
export class TestConduit implements Conduit {
	constructor(private readonly dispatch: TDispatch) {}

	async follow<T = TRepresentation>(link: TLink, _why: string): Promise<T> {
		const result = await this.dispatch(link.method, link.params ?? {}, link);
		return result as T;
	}

	/** A plain answer is the chunk, or the chunks, the stream sends in order, announced at seqPath [0]; a `DrivenStream`
	 *  is sent as its case drives it. Either is announced once the dispatch answers, before a chunk arrives. */
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
			running.catch(() => undefined);
			await Promise.race([running, aborted]);
		} finally {
			open = false;
			signal?.removeEventListener("abort", abort);
		}
		return { seqPath: stream.seqPath ?? [] };
	}

	group<T>(_why: string, fn: (g: Conduit) => Promise<T>): Promise<T> {
		return fn(this);
	}
}

import { setEventStream, SerializedEventStream, type TEvent } from "./event-stream.js";
import { endPage } from "./page-pinned.js";
import { setDeviceStore, MemoryDeviceStore, CACHE_SHAPE } from "./client-cache/index.js";
import { hydrateFromDom, onStepsChanged } from "./rpc-registry.js";
import { CLIENT_LOG_ACTION, CLIENT_LOG_METHOD, type TClientLogLevel } from "./client-log.js";
import { openPageAuthority, type TPageAuthority } from "./page-key.js";
import type { TDelegations } from "@haibun/core/lib/authority-types.js";
import { SHOW_STEPS_METHOD, STEP_DETAIL, readShownSteps, stepDefinition, type TStepDefinitions } from "@haibun/core/lib/step-discovery.js";
import { requiredAction } from "@haibun/core/lib/actions.js";
import { steppersOf } from "@haibun/core/lib/step-registry.js";
import { ARTIFACTS_ROUTE } from "@haibun/core/lib/run-artifact.js";
import { buildConcernCatalog, type TConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { LinkRelations, type TDomainDefinition, type TEdgeDef, type TRel } from "@haibun/core/lib/resources.js";
import { fromJsonText } from "@haibun/core/lib/json-text.js";
import { z } from "zod";
import { STEPS_CHANGED } from "@haibun/core/schema/protocol.js";

type TShuTestConfig = {
	/** Optional dispatch for in-test RPCs. Default throws on every call, naming the unconfigured method, tests opt in by supplying a function that returns wire results for the methods they exercise. */
	dispatch?: TDispatch;
	/** What the run answers a read of one of its artifacts with, given the read as the page sent it: an empty image unless a test says otherwise. */
	artifact?: (url: string, init?: RequestInit) => Response;
};

/** Answer a view's reads of the run's artifacts as the run's artifact route does, and show what it read at an object URL
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
	/** Drive a scripted event into the installed `EventStream`. Components subscribed via `eventStream()` see it as if it had arrived over SSE. */
	emit: (event: TEvent) => void;
	/** Tear down both services. Call from `afterEach` (or rely on the next `beforeEach`'s `setupShuTest` overwriting them: both are valid). */
	teardown: () => void;
	/** The `TestConduit` instance installed under `conduit()`. Exposed for assertions that need to swap the dispatch mid-test or read the instance identity. */
	conduit: TestConduit;
	/** The `SerializedEventStream` instance installed under `eventStream()`. Exposed for assertions that need its `totalRecorded()` or to inspect identity. */
	eventStream: SerializedEventStream;
};

/** Signal on the run's stream that its steps changed, as the run does when a feature declares a step; `n` tells one
 *  signal from another. */
export const stepsChanged = (handle: TShuTestHandle, n: number): void =>
	handle.emit({ id: `${STEPS_CHANGED}-${n}`, timestamp: Date.now(), kind: "control", level: "debug", signal: STEPS_CHANGED });

/** Resolves once the page has read the run's steps again, and what that read told has settled. */
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
	}: { selector?: string; description?: string; properties?: Record<string, TRel>; edges?: Record<string, TEdgeDef>; declared?: boolean } = {},
): TDomainDefinition {
	const schema = z.object({ id: z.string(), generatedAtTime: z.string(), ...Object.fromEntries(Object.keys(properties).map((field) => [field, z.string()])) });
	return {
		selectors: [selector],
		schema: fromJsonText(schema),
		description,
		topology: { persistedAs: label, id: "id", properties: { id: LinkRelations.IDENTIFIER.rel, ...properties, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel }, edges },
		// A feature's `set of {domain} by …` declaration marks what it registers this way.
		...(declared ? { ui: { declared: true } } : {}),
	};
}

/** The steps given, the domains given, and the types the catalog given declares, as the show steps step returns them
 *  when they are all a run declares. */
export function stepsShown(
	steps: Array<{
		method: string;
		stepperName: string;
		stepName: string;
		pattern: string;
		fallback?: boolean;
		read?: boolean;
		answersTheTurn?: boolean;
		capability?: string;
		paramDomains?: Record<string, string>;
		productsDomain?: string;
	}>,
	domains: TStepDefinitions["domains"] = {},
	concerns: TConcernCatalog = buildConcernCatalog({}),
): TStepDefinitions {
	const described = steps.map((step) => ({
		...step,
		// Each step requires what a run's step would: what it declares, a public read for a read, and otherwise its name.
		capability: requiredAction(step.stepperName, step.stepName, step),
		stepperDescription: `the steps of ${step.stepperName}`,
		paramDomains: step.paramDomains ?? {},
		read: step.read === true,
		fallback: step.fallback === true,
		answersTheTurn: step.answersTheTurn === true,
		inputSchema: { type: "object" as const, properties: {}, required: [] },
	}));
	const shown = { detail: STEP_DETAIL.definition, steppers: steppersOf(described), steps: described.map(stepDefinition), domains, concerns };
	return readShownSteps(shown, STEP_DETAIL.definition);
}

/** A dispatch over a run that declares what `shown` returns each time the page reads its steps; any other call throws. */
export const declaringSteps =
	(shown: () => TStepDefinitions): TDispatch =>
	(method) => {
		if (method === SHOW_STEPS_METHOD) return shown();
		throw new Error(`unexpected ${method}`);
	};

/** The two steps the entity surface calls, as the show steps step returns them: the fixture every entity test installs. */
export const ENTITY_STEP_LIST = stepsShown([
	{ method: "GraphStepper-getIndividualWithEdges", stepperName: "GraphStepper", stepName: "getIndividualWithEdges", pattern: "get vertex {label} {id}" },
	{ method: "ResourcesStepper-annotations", stepperName: "ResourcesStepper", stepName: "annotations", pattern: "get annotations for {label} {id}" },
]);

/** A dispatch over the entity surface: the show steps step answers with {@link ENTITY_STEP_LIST}, the two entity steps route
 *  to the given answerers (annotations defaults to an empty list), and anything else throws: the loud-failure signal. */
export function makeEntityDispatch(over: { entity: () => unknown; annotations?: () => unknown }): TDispatch {
	return (method) => {
		if (method === SHOW_STEPS_METHOD) return ENTITY_STEP_LIST;
		if (method === "GraphStepper-getIndividualWithEdges") return over.entity();
		if (method === "ResourcesStepper-annotations") return over.annotations ? over.annotations() : { annotations: [] };
		throw new Error(`unexpected ${method}`);
	};
}

/** A report the page sent the run through the monitor's client-log step. */
export type TReportedToRun = { level: TClientLogLevel; source: string; message: string; attributes?: Record<string, unknown> };

/** Open the page's authority as a page the run lets report to it: it holds what reporting requires, beside
 *  `withoutDelegation` and what `read` delegates. A test that opens one needs an IndexedDB for the page's key. */
export const openReportingPage = (read?: () => Promise<TDelegations>, withoutDelegation: string[] = []): Promise<TPageAuthority> =>
	openPageAuthority(read, [CLIENT_LOG_ACTION, ...withoutDelegation]);

/** A dispatch answering the page's reports to the run as the monitor's client-log step does, holding each in `reported`;
 *  any other call throws. */
export function reportingTo(reported: TReportedToRun[]): TDispatch {
	return (method, params) => {
		if (method !== CLIENT_LOG_METHOD) throw new Error(`unexpected ${method}`);
		reported.push(params.event as TReportedToRun);
		return {};
	};
}

/** jsdom doesn't implement media queries, so a component that asks the viewport a question (the strip asks whether it
 *  is narrow or portrait before it lays panes out) throws only there. Install the query API the browser always has,
 *  answering "no match": a jsdom window doesn't have an orientation or a width to match on. `setupShuTest` calls this;
 *  a DOM test that doesn't install services calls it directly. */
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

/** The run a test page carries. */
const CARRIED_RUN = { shape: CACHE_SHAPE, execution: "r1", quads: [] };

/** Give the page the hydration a deployment writes, in place of any it carried. The page reads it at `hydrateFromDom`. */
export function hydrate(payload: unknown): HTMLScriptElement {
	document.getElementById(HYDRATION_ID)?.remove();
	const script = document.createElement("script");
	script.type = "application/json";
	script.id = HYDRATION_ID;
	script.textContent = JSON.stringify(payload);
	document.head.appendChild(script);
	return script;
}

/** Make this page a record of a run: it carries one, so it doesn't have a server behind it. */
export function carryARun(): void {
	hydrate({ cache: CARRIED_RUN });
	hydrateFromDom();
}

/** Make it a served page again. */
export function carryNothing(): void {
	document.getElementById(HYDRATION_ID)?.remove();
	hydrateFromDom();
}

export function setupShuTest(config: TShuTestConfig = {}): TShuTestHandle {
	installTestMediaQueries();
	const dispatch: TDispatch =
		config.dispatch ??
		((method) => {
			throw new Error(
				`setupShuTest: a dispatch for "${method}" isn't configured. Pass setupShuTest({ dispatch: (method, params) => ... }) and return a wire result for the methods this test exercises.`,
			);
		});
	const conduit = new TestConduit(dispatch);
	const eventStream = new SerializedEventStream();
	const stopServingArtifacts = servingArtifacts(config.artifact ?? (() => new Response(new Blob([], { type: "image/png" }))));
	setConduit(conduit);
	setEventStream(eventStream);
	setDeviceStore(new MemoryDeviceStore());
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
