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
import { describe, it, expect, beforeEach } from "vitest";
import { hydrateFromDom, isStandaloneMode } from "./rpc-registry.js";

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

