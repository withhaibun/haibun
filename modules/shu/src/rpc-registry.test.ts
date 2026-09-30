// @vitest-environment jsdom
/**
 * A served page and a record of a run both ship a `<script id="shu-hydration">` element, since the live template injects
 * an empty one so the page shape is stable. What tells them apart is actuality: a record carries one, a served page never
 * does, and a page that carries its own run doesn't have a server behind it.
 *
 * If the signal widened to the script alone, every served page would decide it didn't have a server and stop reaching the one
 * it has. These tests pin the rule.
 */
import { HYDRATION_ID } from "./consts.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	RESPONSE_TIMEOUT_MS,
	deploymentAskToolLimit,
	deploymentEmbedderOrigin,
	deploymentMs,
	getAvailableSteps,
	hydrateFromDom,
	isOffline,
	registryOrigin,
	requireStep,
	responseTimeoutMs,
	stepsJoining,
	pageBuild,
} from "./rpc-registry.js";
import { asDomainKey } from "@haibun/core/lib/domains.js";
import { setupShuTest, stepsShown, type TShuTestHandle, hydrate } from "./test-setup.js";
import { ServerUnreachable } from "./hypermedia.js";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { deviceStore, setDeviceStore, MemoryDeviceStore } from "./client-cache/index.js";
import { endPage } from "./page-pinned.js";

function setHydration(payload: unknown): void {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	hydrate(payload);
}

describe("a page that carries its own run doesn't have a server behind it", () => {
	beforeEach(() => {
		document.head.innerHTML = "";
		document.body.innerHTML = "";
	});

	it("reports so when the page carries a run", () => {
		setHydration({ cache: { shape: "run-indexed-events/1", run: "r1", events: [], extents: {} }, rpcCache: {}, viewHash: "" });
		hydrateFromDom();
		expect(isOffline()).toBe(true);
	});

	it("doesn't report so for the served template, which carries an empty hydration", () => {
		setHydration({});
		hydrateFromDom();
		expect(isOffline()).toBe(false);
	});

	it("doesn't report so when the page doesn't have a hydration script", () => {
		hydrateFromDom();
		expect(isOffline()).toBe(false);
	});

	// The embedded payload carries the whole run, every event, as one string. Parsing it is its only reader, so the
	// text goes: left in the DOM it would cache a second copy of actuality beside the objects parsed out of it.
	it("does not keep the embedded run in the DOM once it has been parsed", () => {
		setHydration({ cache: { shape: "run-indexed-events/1", run: "r1", events: [{ id: "0.1", message: "x" }], extents: {} }, viewHash: "" });
		hydrateFromDom();
		expect(document.getElementById(HYDRATION_ID)?.textContent).toBe("");
		expect(isOffline()).toBe(true); // decided by the parsed data, not the DOM text
	});
});

describe("the timings a deployment sets", () => {
	beforeEach(() => {
		document.head.innerHTML = "";
		document.body.innerHTML = "";
	});

	it("answers with what the deployment set", () => {
		setHydration({ settings: { streamReconnectAfterMs: 500 } });
		hydrateFromDom();
		expect(deploymentMs("streamReconnectAfterMs")).toBe(500);
	});

	it("answers the embedding page's origin and the rounds an ask starts with, as the deployment set them", () => {
		setHydration({ settings: { embedderOrigin: "chrome-extension://abcdefghijklmnop", askToolLimit: 7 } });
		hydrateFromDom();
		expect(deploymentEmbedderOrigin()).toBe("chrome-extension://abcdefghijklmnop");
		expect(deploymentAskToolLimit()).toBe(7);
	});

	it("states the build the page's code is from, which a page that didn't start shows", () => {
		setHydration({ settings: { build: { version: "4.0.0", builtAt: "2026-09-30T12:00:00.000Z" } } });
		hydrateFromDom();
		expect(pageBuild()).toBe("haibun 4.0.0, page code built 2026-09-30T12:00:00.000Z");
		setHydration({ settings: {} });
		hydrateFromDom();
		expect(pageBuild(), "a page served without it doesn't state one").toBeUndefined();
	});

	it("answers with undefined where the deployment didn't set a value, so the page applies what it carries", () => {
		setHydration({ settings: {} });
		hydrateFromDom();
		expect(deploymentMs("streamReconnectAfterMs")).toBeUndefined();
	});

	it("refuses a value the page cannot apply, rather than reading it as unset", () => {
		setHydration({ settings: { streamReconnectAfterMs: 0 } });
		hydrateFromDom();
		expect(() => deploymentMs("streamReconnectAfterMs")).toThrow(/above zero/);
		setHydration({ settings: { streamReconnectAfterMs: "soon" } });
		hydrateFromDom();
		expect(() => deploymentMs("streamReconnectAfterMs")).toThrow(/above zero/);
	});
});

describe("how long a call to the site may take", () => {
	beforeEach(() => {
		document.head.innerHTML = "";
		document.body.innerHTML = "";
	});

	it("allows what the product carries where the deployment doesn't set a value", () => {
		setHydration({ settings: {} });
		hydrateFromDom();
		expect(responseTimeoutMs()).toBe(RESPONSE_TIMEOUT_MS);
	});

	it("allows what the deployment set, so a deployment reading a slower store raises it", () => {
		setHydration({ settings: { responseTimeoutMs: 250 } });
		hydrateFromDom();
		expect(responseTimeoutMs()).toBe(250);
	});

	it("is far above what a read takes, which is what makes it a sign of a site that has stopped answering", () => {
		// Measured: a page read over eight thousand messages answers in 10ms on average and 64ms at the ninety-fifth,
		// the consumer holds its queries to 200ms, and the heaviest read either repository measures is 727ms.
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
		setHydration({});
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
		setHydration({});
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
		setHydration({});
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
