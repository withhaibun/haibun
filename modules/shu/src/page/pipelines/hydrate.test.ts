// @vitest-environment jsdom
/**
 * A served page and a page that carries a record of actuality both hold a hydration element. The record distinguishes them:
 * a page that carries one isn't served by a site, and a served page states the settings its deployment wrote.
 */
import { HYDRATION_ID } from "../../domains/elements.js";
import { describe, it, expect, beforeEach } from "vitest";
import {
	deploymentAskToolLimit,
	deploymentEmbedderOrigin,
	deploymentStreamReconnectMs,
	hydrateFromDom,
	isOffline,
	responseTimeoutMs,
	pageBuild,
} from "../controllers/hydration-controller.js";
import { hydrate, PAGE_ACTUALITY, SERVED_SETTINGS, servedWith } from "../../test/setup.js";
import { RESPONSE_TIMEOUT_MS } from "../../domains/hydration.js";
import { CACHE_SHAPE } from "../client-cache/ports.js";

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

	it("returns the timings, the embedding page's origin and the rounds an ask starts with, as the deployment set them", () => {
		setHydration({
			actualityId: PAGE_ACTUALITY,
			settings: servedWith({ streamReconnectAfterMs: 500, responseTimeoutMs: 250, embedderOrigin: "chrome-extension://abcdefghijklmnop", askToolLimit: 7 }),
		});
		hydrateFromDom();
		expect(deploymentStreamReconnectMs()).toBe(500);
		expect(responseTimeoutMs()).toBe(250);
		expect(deploymentEmbedderOrigin()).toBe("chrome-extension://abcdefghijklmnop");
		expect(deploymentAskToolLimit()).toBe(7);
	});

	it("returns undefined for an optional setting the deployment didn't set", () => {
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
