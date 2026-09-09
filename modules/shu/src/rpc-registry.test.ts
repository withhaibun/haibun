// @vitest-environment jsdom
/**
 * A served page and a record of a run both ship a `<script id="shu-hydration">` element, since the live template injects
 * an empty one so the page shape is stable. What tells them apart is the run: a record carries one, a served page never
 * does, and a page that carries its own run has no server behind it.
 *
 * If the signal widened to the script alone, every served page would decide it had no server and stop reaching the one
 * it has. These tests pin the rule.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SITE_ANSWERS_WITHIN_MS, deploymentMs, getAvailableSteps, hydrateFromDom, isOffline, registryOrigin, requireStep, resetStepRegistry, siteAnswersWithinMs } from "./rpc-registry.js";
import { setupShuTest, type TShuTestHandle } from "./test-setup.js";
import { deviceStore, setDeviceStore, MemoryDeviceStore } from "./client-cache/index.js";

function setHydration(payload: unknown): void {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	const s = document.createElement("script");
	s.type = "application/json";
	s.id = "shu-hydration";
	s.textContent = JSON.stringify(payload);
	document.head.appendChild(s);
}

describe("a page that carries its own run has no server behind it", () => {
	beforeEach(() => {
		document.head.innerHTML = "";
		document.body.innerHTML = "";
	});

	it("says so when the page carries a run", () => {
		setHydration({ cache: { shape: "run-indexed-events/1", run: "r1", events: [], extents: {} }, rpcCache: {}, viewHash: "" });
		hydrateFromDom();
		expect(isOffline()).toBe(true);
	});

	it("says nothing of the sort for the served template, which carries an empty hydration", () => {
		setHydration({});
		hydrateFromDom();
		expect(isOffline()).toBe(false);
	});

	it("says nothing of the sort when there is no hydration script at all", () => {
		hydrateFromDom();
		expect(isOffline()).toBe(false);
	});

	// The embedded payload carries the whole run — every event — as one string. Parsing it is its only reader, so the
	// text goes: left in the DOM it would cache a second copy of the run beside the objects parsed out of it.
	it("does not keep the embedded run in the DOM once it has been parsed", () => {
		setHydration({ cache: { shape: "run-indexed-events/1", run: "r1", events: [{ id: "0.1", message: "x" }], extents: {} }, viewHash: "" });
		hydrateFromDom();
		expect(document.getElementById("shu-hydration")?.textContent).toBe("");
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

	it("answers with nothing where the deployment set nothing, so the page applies what it carries", () => {
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

	it("allows what the product carries where the deployment sets nothing", () => {
		setHydration({ settings: {} });
		hydrateFromDom();
		expect(siteAnswersWithinMs()).toBe(SITE_ANSWERS_WITHIN_MS);
	});

	it("allows what the deployment set, so a deployment reading a slower store raises it", () => {
		setHydration({ settings: { siteAnswersWithinMs: 250 } });
		hydrateFromDom();
		expect(siteAnswersWithinMs()).toBe(250);
	});

	it("is far above what a read costs, which is what makes it a sign of a site that has stopped answering", () => {
		// Measured: a page read over eight thousand messages answers in 10ms on average and 64ms at the ninety-fifth,
		// the consumer holds its queries to 200ms, and the heaviest read either repository measures is 727ms.
		expect(SITE_ANSWERS_WITHIN_MS).toBeGreaterThan(727 * 10);
	});
});

const aStep = (stepperName: string, stepName: string, fallback: boolean) => ({
	stepperName,
	stepName,
	method: `${stepperName}-${stepName}`,
	pattern: `${stepName} something`,
	params: {},
	...(fallback ? { fallback: true } : {}),
});

describe("the step a name answers to", () => {
	// Two steppers may declare one step name: the site says which of them is a fallback, and a page naming the step
	// takes the one that is not. A deployment that brings its own step is read through its own step.
	let handle: TShuTestHandle;
	const listing = (steps: unknown[]) => setupShuTest({ dispatch: (method) => (method === "step.list" ? { steps, domains: {}, concerns: { persisted: {} } } : undefined) });
	beforeEach(() => {
		setHydration({});
		resetStepRegistry();
		setDeviceStore(new MemoryDeviceStore());
	});
	afterEach(() => {
		handle?.teardown();
		resetStepRegistry();
	});

	it("takes the step that is not a fallback, whichever the site listed first", async () => {
		handle = listing([aStep("GraphSourceStepper", "graphQuery", true), aStep("GraphStepper", "graphQuery", false)]);
		await getAvailableSteps();
		expect(requireStep("graphQuery")).toBe("GraphStepper-graphQuery");
		handle.teardown();
		resetStepRegistry();
		setDeviceStore(new MemoryDeviceStore());
		handle = listing([aStep("GraphStepper", "graphQuery", false), aStep("GraphSourceStepper", "graphQuery", true)]);
		await getAvailableSteps();
		expect(requireStep("graphQuery")).toBe("GraphStepper-graphQuery");
	});

	it("takes the fallback where nothing else answers to the name", async () => {
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
	// The site's response to step.list is cached on the device; a page whose site does not respond runs on that copy and reports
	// so; with neither, the request fails as it did.
	const ANSWER = { steps: [], domains: {}, concerns: { persisted: {} } };
	let handle: TShuTestHandle;
	beforeEach(() => {
		setHydration({});
		resetStepRegistry();
	});
	afterEach(() => {
		handle?.teardown();
		resetStepRegistry();
	});

	it("caches the server's response on the device and runs on it when the server does not respond; with neither, fails", async () => {
		handle = setupShuTest({ dispatch: (method) => (method === "step.list" ? ANSWER : undefined) });
		await getAvailableSteps();
		expect(registryOrigin()).toEqual({ from: "server" });
		const store = deviceStore() as MemoryDeviceStore;
		await new Promise((r) => setTimeout(r, 0)); // cached without holding the page up
		expect((await store.registry())?.response, "the response as validated, cached on the device").toMatchObject(ANSWER);
		// The same device, a server that does not respond: the page runs on the device's copy.
		handle.teardown();
		resetStepRegistry();
		handle = setupShuTest({
			dispatch: () => {
				throw new Error("offline");
			},
		});
		setDeviceStore(store);
		await getAvailableSteps();
		expect(registryOrigin()?.from).toBe("device");
		expect(typeof registryOrigin()?.savedAt).toBe("number");
		// A device with nothing cached and a server that does not respond: the failure is the server's.
		resetStepRegistry();
		setDeviceStore(new MemoryDeviceStore());
		await expect(getAvailableSteps()).rejects.toThrow("offline");
	});
});
