// @vitest-environment jsdom
/** The page reads actuality's steps from its site, from the device's copy where the site doesn't respond, and from the
 *  registry a carried record holds; a name indexes one step. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { hydrateFromDom, hydratedCache } from "../controllers/hydration-controller.js";
import { getAvailableSteps, registryOrigin, requireStep, stepsJoining } from "../controllers/registry-controller.js";
import { asDomainKey } from "@haibun/core/lib/domains.js";
import { setupShuTest, stepsShown, type TShuTestHandle, hydrate, PAGE_ACTUALITY, SERVED_SETTINGS } from "../../test/setup.js";
import { CACHE_SHAPE } from "../client-cache/ports.js";
import { hydrateClientCache } from "../client-cache/controllers/device-controller.js";
import { installCarriedConduit } from "../root.js";
import { ServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { installDeviceStore, installMemoryDeviceStore, pageDeviceStore } from "../client-cache/root.js";
import { endPage } from "../adapters/page-held.js";

function setHydration(payload: unknown): void {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	hydrate(payload);
}

const aStep = (stepperName: string, stepName: string, fallback: boolean) => ({
	stepperName,
	stepName,
	method: `${stepperName}-${stepName}`,
	pattern: `${stepName} something`,
	fallback,
});

describe("the step a name indexes", () => {
	// Two steppers may declare one step name: the site states which of them is a fallback, and a page naming the step
	// takes the one that is not. A deployment that brings its own step is read through its own step.
	let handle: TShuTestHandle;
	const listing = (steps: Parameters<typeof stepsShown>[0]) => setupShuTest({ dispatch: (method) => (method === SHOW_STEPS_METHOD ? stepsShown(steps) : undefined) });
	beforeEach(() => {
		endPage();
		setHydration({ actualityId: PAGE_ACTUALITY, settings: SERVED_SETTINGS });
		installMemoryDeviceStore();
	});
	afterEach(() => {
		handle?.teardown();
	});

	it("takes the step that is not a fallback, whichever the site listed first", async () => {
		handle = listing([aStep("GraphSourceStepper", "graphQuery", true), aStep("GraphStepper", "graphQuery", false)]);
		await getAvailableSteps();
		expect(requireStep("graphQuery")).toBe("GraphStepper-graphQuery");
		handle.teardown();
		installMemoryDeviceStore();
		handle = listing([aStep("GraphStepper", "graphQuery", false), aStep("GraphSourceStepper", "graphQuery", true)]);
		await getAvailableSteps();
		expect(requireStep("graphQuery")).toBe("GraphStepper-graphQuery");
	});

	it("takes the fallback where the name doesn't index another step", async () => {
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
		expect(registryOrigin()).toEqual({ from: "site" });
		const store = pageDeviceStore();
		await new Promise((r) => setTimeout(r, 0)); // cached without holding the page up
		expect((await store.registry())?.response, "the response as validated, cached on the device").toMatchObject(ANSWER);
		// The same device, a server that does not respond: the page runs on the device's copy.
		handle.teardown();
		handle = setupShuTest({ dispatch: unreachable });
		installDeviceStore(store);
		await getAvailableSteps();
		const origin = registryOrigin();
		expect(origin !== undefined && origin.from === "device" && typeof origin.savedAt === "number", JSON.stringify(origin)).toBe(true);
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

	it("returns a site's refusal, not the device's copy, so the page doesn't read from the device what the site refuses", async () => {
		handle = setupShuTest({ dispatch: (method) => (method === SHOW_STEPS_METHOD ? ANSWER : undefined) });
		await getAvailableSteps();
		const store = pageDeviceStore();
		await new Promise((r) => setTimeout(r, 0));
		handle.teardown();
		handle = setupShuTest({
			dispatch: () => {
				throw new Error(`${SHOW_STEPS_METHOD}: capability Read:public required`);
			},
		});
		installDeviceStore(store);
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
