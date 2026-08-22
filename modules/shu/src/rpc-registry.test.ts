// @vitest-environment jsdom
/**
 * Live and offline pages both ship a `<script id="shu-hydration">` element —
 * the live SSR template injects `{}` so the page shape is stable. The
 * distinguishing signal is whether `rpcCache` is present:
 *   - live serve: `{}`                         → no rpcCache → live
 *   - standalone save: `{rpcCache, viewHash}` → rpcCache    → offline
 *
 * If a future change widens the offline signal (e.g. presence of the script
 * alone), every live page would erroneously enter offline mode and the very
 * first action would throw `OfflineError`. These tests pin the rule.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { hydrateFromDom, isStandaloneMode, getAvailableSteps, registryOrigin, resetStepRegistry } from "./rpc-registry.js";
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

describe("isStandaloneMode", () => {
	beforeEach(() => {
		document.head.innerHTML = "";
		document.body.innerHTML = "";
	});

	it("returns true when the hydration script carries an rpcCache (typical save)", () => {
		setHydration({ events: [], rpcCache: { "step.list": { steps: [] } }, viewHash: "" });
		hydrateFromDom();
		expect(isStandaloneMode()).toBe(true);
	});

	it("returns true when the hydration script carries an empty rpcCache (save with no recorded RPC)", () => {
		setHydration({ events: [], rpcCache: {}, viewHash: "" });
		hydrateFromDom();
		expect(isStandaloneMode()).toBe(true);
	});

	it("returns false for the live SSR template (`{}` hydration, no rpcCache)", () => {
		setHydration({});
		hydrateFromDom();
		expect(isStandaloneMode()).toBe(false);
	});

	it("returns false when there is no hydration script", () => {
		hydrateFromDom();
		expect(isStandaloneMode()).toBe(false);
	});

	// The embedded payload carries the whole run — every event — as one string. Parsing it is its only reader, so the
	// text goes: left in the DOM it would hold a second copy of the run beside the objects parsed out of it.
	it("does not keep the embedded run in the DOM once it has been parsed", () => {
		setHydration({ rpcCache: { "MonitorStepper-getEvents": { events: [{ id: "0.1", message: "x" }] } }, viewHash: "" });
		hydrateFromDom();
		expect(document.getElementById("shu-hydration")?.textContent).toBe("");
		expect(isStandaloneMode()).toBe(true); // the mode is decided by the parsed data, not the DOM text
	});
});

describe("the registry kept on the device", () => {
	// The site's answer to step.list is kept on the device; a page whose site does not answer runs on that copy and says
	// so; with neither, the ask fails as it did.
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

	it("keeps the site's answer on the device and runs on it when the site does not answer; with neither, fails", async () => {
		handle = setupShuTest({ dispatch: (method) => (method === "step.list" ? ANSWER : undefined) });
		await getAvailableSteps();
		expect(registryOrigin()).toEqual({ from: "site" });
		const store = deviceStore() as MemoryDeviceStore;
		await new Promise((r) => setTimeout(r, 0)); // kept without holding the page up
		expect((await store.registry())?.answer, "the answer as validated, kept on the device").toMatchObject(ANSWER);
		// The same device, a site that does not answer: the page runs on the device's copy.
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
		// A device with nothing kept and a site that does not answer: the failure is the site's.
		resetStepRegistry();
		setDeviceStore(new MemoryDeviceStore());
		await expect(getAvailableSteps()).rejects.toThrow("offline");
	});
});
