// @vitest-environment jsdom
/**
 * A served page and a record of a run both ship a `<script id="shu-hydration">` element, since the live template injects
 * an empty one so the page shape is stable. What tells them apart is actuality: a record carries one, a served page never
 * does, and a page that carries its own run doesn't have a server behind it.
 *
 * If the signal widened to the script alone, every served page would decide it didn't have a server and stop reaching the one
 * it has. These tests pin the rule.
 */
import { HYDRATION_ID } from "./domains/elements.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	deploymentAskToolLimit,
	deploymentEmbedderOrigin,
	deploymentStreamReconnectMs,
	getAvailableSteps,
	hydrateFromDom,
	hydratedCache,
	isOffline,
	registryOrigin,
	requireStep,
	responseTimeoutMs,
	stepsJoining,
	pageBuild,
} from "./rpc-registry.js";
import { asDomainKey } from "@haibun/core/lib/domains.js";
import { setupShuTest, stepsShown, type TShuTestHandle, hydrate, PAGE_ACTUALITY, SERVED_SETTINGS, servedWith } from "./test-setup.js";
import { RESPONSE_TIMEOUT_MS } from "./domains/hydration.js";
import { CACHE_SHAPE, hydrateClientCache } from "./client-cache/index.js";
import { installCarriedConduit } from "./page/root.js";
import { ServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { deviceStore, setDeviceStore, MemoryDeviceStore } from "./client-cache/index.js";
import { endPage } from "./page/adapters/page-held.js";

/** A record of actuality a test page carries. */
const CARRIED = { shape: CACHE_SHAPE, execution: "r1", quads: [] };

function setHydration(payload: unknown): void {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	hydrate(payload);
}

describe("a page that carries a record of actuality doesn't have a site behind it", () => {
	beforeEach(() => {
		document.head.innerHTML = "";
		document.body.innerHTML = "";
	});

	it("reports so where the page carries a record", () => {
		setHydration({ actualityId: PAGE_ACTUALITY, cache: CARRIED });
		hydrateFromDom();
		expect(isOffline()).toBe(true);
	});

	it("doesn't report so for a page a site served", () => {
		setHydration({ actualityId: PAGE_ACTUALITY, settings: SERVED_SETTINGS });
		hydrateFromDom();
		expect(isOffline()).toBe(false);
	});

	it("doesn't report so where the page doesn't hold a hydration element", () => {
		hydrateFromDom();
		expect(isOffline()).toBe(false);
	});

	// The element holds the whole record as one string. Parsing it is its one reader, so the text goes: left in the
	// document it would hold a second copy of actuality beside the objects parsed from it.
	it("doesn't keep the record in the document once it parses it", () => {
		setHydration({ actualityId: PAGE_ACTUALITY, cache: CARRIED });
		hydrateFromDom();
		expect(document.getElementById(HYDRATION_ID)?.textContent).toBe("");
		expect(isOffline()).toBe(true);
	});

	it("refuses a hydration its schema refuses, and names each field", () => {
		setHydration({ actualityId: PAGE_ACTUALITY, cache: { shape: "run-indexed-events/1", run: "r1", events: [] } });
		expect(() => hydrateFromDom()).toThrow(/the page's hydration doesn't match its schema: .*cache/);
		setHydration({ actualityId: PAGE_ACTUALITY, settings: servedWith({ streamReconnectAfterMs: 0 }) });
		expect(() => hydrateFromDom(), "a timing the page can't apply is refused at the page's start").toThrow(/streamReconnectAfterMs/);
		setHydration({ actualityId: PAGE_ACTUALITY, settings: { responseTimeoutMs: 250 } });
		expect(() => hydrateFromDom(), "a served page states every setting a deployment writes").toThrow(/allowedWithoutDelegation/);
	});
});

describe("what a deployment sets", () => {
	beforeEach(() => {
		document.head.innerHTML = "";
		document.body.innerHTML = "";
	});

	it("answers the timings, the embedding page's origin and the rounds an ask starts with, as the deployment set them", () => {
		setHydration({ actualityId: PAGE_ACTUALITY, settings: servedWith({ streamReconnectAfterMs: 500, responseTimeoutMs: 250, embedderOrigin: "chrome-extension://abcdefghijklmnop", askToolLimit: 7 }) });
		hydrateFromDom();
		expect(deploymentStreamReconnectMs()).toBe(500);
		expect(responseTimeoutMs()).toBe(250);
		expect(deploymentEmbedderOrigin()).toBe("chrome-extension://abcdefghijklmnop");
		expect(deploymentAskToolLimit()).toBe(7);
	});

	it("answers undefined for an optional setting the deployment didn't set", () => {
		setHydration({ actualityId: PAGE_ACTUALITY, settings: SERVED_SETTINGS });
		hydrateFromDom();
		expect(deploymentStreamReconnectMs()).toBeUndefined();
		expect(deploymentEmbedderOrigin()).toBeUndefined();
	});

	it("states the build the page's code is from, which a page that didn't start shows", () => {
		setHydration({ actualityId: PAGE_ACTUALITY, settings: servedWith({ build: { version: "4.0.0", builtAt: "2026-09-30T12:00:00.000Z" } }) });
		hydrateFromDom();
		expect(pageBuild()).toBe("haibun 4.0.0, page code built 2026-09-30T12:00:00.000Z");
	});

	it("throws for a setting of a page a site didn't serve, and names what writes the settings", () => {
		setHydration({ actualityId: PAGE_ACTUALITY, cache: CARRIED });
		hydrateFromDom();
		expect(() => responseTimeoutMs()).toThrow(/wasn't served with its deployment's settings: a site's ShuStepper writes them/);
	});

	it("allows far more than a read takes, which is what makes a timeout a sign of a site that stopped responding", () => {
		// Measured: a page read over eight thousand messages takes 10ms on average and 64ms at the ninety-fifth percentile,
		// the consumer holds its queries to 200ms, and the slowest read either repository measures takes 727ms.
		expect(RESPONSE_TIMEOUT_MS).toBeGreaterThan(727 * 10);
	});
});

const aStep = (stepperName: string, stepName: string, fallback: boolean) => ({
	stepperName,
	stepName,
	method: `${stepperName}-${stepName}`,
	pattern: `${stepName} something`,
	fallback,
});

describe("the step a name answers to", () => {
	// Two steppers may declare one step name: the site states which of them is a fallback, and a page naming the step
	// takes the one that is not. A deployment that brings its own step is read through its own step.
	let handle: TShuTestHandle;
	const listing = (steps: Parameters<typeof stepsShown>[0]) => setupShuTest({ dispatch: (method) => (method === SHOW_STEPS_METHOD ? stepsShown(steps) : undefined) });
	beforeEach(() => {
		endPage();
		setHydration({ actualityId: PAGE_ACTUALITY, settings: SERVED_SETTINGS });
		setDeviceStore(new MemoryDeviceStore());
	});
	afterEach(() => {
		handle?.teardown();
	});

	it("takes the step that is not a fallback, whichever the site listed first", async () => {
		handle = listing([aStep("GraphSourceStepper", "graphQuery", true), aStep("GraphStepper", "graphQuery", false)]);
		await getAvailableSteps();
		expect(requireStep("graphQuery")).toBe("GraphStepper-graphQuery");
		handle.teardown();
		setDeviceStore(new MemoryDeviceStore());
		handle = listing([aStep("GraphStepper", "graphQuery", false), aStep("GraphSourceStepper", "graphQuery", true)]);
		await getAvailableSteps();
		expect(requireStep("graphQuery")).toBe("GraphStepper-graphQuery");
	});

	it("takes the fallback where the other steps don't answer to the name", async () => {
		handle = listing([aStep("GraphSourceStepper", "graphQuery", true)]);
		await getAvailableSteps();
		expect(requireStep("graphQuery")).toBe("GraphSourceStepper-graphQuery");
	});

	it("takes the step by its own method, which names one stepper", async () => {
		handle = listing([aStep("GraphSourceStepper", "graphQuery", true), aStep("GraphStepper", "graphQuery", false)]);
		await getAvailableSteps();
		expect(requireStep("GraphSourceStepper-graphQuery")).toBe("GraphSourceStepper-graphQuery");
	});
});

describe("the registry cached on the device", () => {
	// The site's response to the show steps step is cached on the device; a page whose site does not respond runs on that copy and reports
	// so; without either, the request fails as it did.
	const ANSWER = stepsShown([]);
	const unreachable = () => {
		throw new ServerUnreachable(`/rpc/${SHOW_STEPS_METHOD}`, new Error("offline"));
	};
	let handle: TShuTestHandle;
	beforeEach(() => {
		endPage();
		setHydration({ actualityId: PAGE_ACTUALITY, settings: SERVED_SETTINGS });
	});
	afterEach(() => {
		handle?.teardown();
	});

	it("caches the server's response on the device and runs on it when the server does not respond; without either, fails", async () => {
		handle = setupShuTest({ dispatch: (method) => (method === SHOW_STEPS_METHOD ? ANSWER : undefined) });
		await getAvailableSteps();
		expect(registryOrigin()).toEqual({ from: "server" });
		const store = deviceStore() as MemoryDeviceStore;
		await new Promise((r) => setTimeout(r, 0)); // cached without holding the page up
		expect((await store.registry())?.response, "the response as validated, cached on the device").toMatchObject(ANSWER);
		// The same device, a server that does not respond: the page runs on the device's copy.
		handle.teardown();
		handle = setupShuTest({ dispatch: unreachable });
		setDeviceStore(store);
		await getAvailableSteps();
		expect(registryOrigin()?.from).toBe("device");
		expect(typeof registryOrigin()?.savedAt).toBe("number");
		// A device without a cached copy and a server that does not respond: the failure is the server's.
		handle.teardown();
		handle = setupShuTest({ dispatch: unreachable });
		await expect(getAvailableSteps()).rejects.toThrow("offline");
	});

	it("reads the steps of a page that carries a record from the registry the record carries, without a site's settings", async () => {
		handle = setupShuTest({ dispatch: unreachable });
		setHydration({ actualityId: PAGE_ACTUALITY, cache: { shape: CACHE_SHAPE, execution: "r1", registry: ANSWER, quads: [] } });
		hydrateFromDom();
		const carried = hydratedCache();
		if (carried === undefined) throw new Error("the test page doesn't carry a record");
		await hydrateClientCache(carried);
		installCarriedConduit();
		await getAvailableSteps();
		expect(registryOrigin()?.from).toBe("device");
	});

	it("answers a server's refusal with the refusal, not with the device's copy, so what a page may no longer read isn't read from the device", async () => {
		handle = setupShuTest({ dispatch: (method) => (method === SHOW_STEPS_METHOD ? ANSWER : undefined) });
		await getAvailableSteps();
		const store = deviceStore() as MemoryDeviceStore;
		await new Promise((r) => setTimeout(r, 0));
		handle.teardown();
		handle = setupShuTest({
			dispatch: () => {
				throw new Error(`${SHOW_STEPS_METHOD}: capability Read:public required`);
			},
		});
		setDeviceStore(store);
		await expect(getAvailableSteps()).rejects.toThrow("capability Read:public required");
		expect(registryOrigin()?.from, "and doesn't run on a copy it was refused").not.toBe("device");
	});
});

describe("the steps a domain joins", () => {
	let handle: TShuTestHandle;
	afterEach(() => {
		handle?.teardown();
	});

	it("are the steps that return it and the steps that take it, named by its key or by the type it persists as, a union's parts included", async () => {
		const [CREDENTIAL, CREDENTIAL_TYPE, CHECK] = ["credential", "VerifiableCredential", "verification"];
		const [issue, verify, either] = [
			{ ...aStep("CredentialsStepper", "issue", false), productsDomain: CREDENTIAL },
			{ ...aStep("VerifierStepper", "verify", false), paramDomains: { credential: CREDENTIAL }, productsDomain: CHECK },
			{ ...aStep("VerifierStepper", "either", false), paramDomains: { what: asDomainKey([CREDENTIAL, CHECK]) } },
		];
		setHydration({ actualityId: PAGE_ACTUALITY, settings: SERVED_SETTINGS });
		handle = setupShuTest({
			dispatch: (method) => (method === SHOW_STEPS_METHOD ? stepsShown([issue, verify, either], { [CREDENTIAL]: { persistedAs: CREDENTIAL_TYPE }, [CHECK]: {} }) : undefined),
		});
		await getAvailableSteps();
		const joined = (name: string) => {
			const { returning, taking } = stepsJoining(name);
			return { returning: returning.map((step) => step.method), taking: taking.map((step) => step.method) };
		};
		expect(joined(CREDENTIAL)).toEqual({ returning: [issue.method], taking: [verify.method, either.method] });
		expect(joined(CREDENTIAL_TYPE), "the same, by the type it persists as").toEqual(joined(CREDENTIAL));
		expect(joined(CHECK)).toEqual({ returning: [verify.method], taking: [either.method] });
	});
});
