// @vitest-environment jsdom
/**
 * Arrival canonicalization: `open=` is the ADDITIVE link form a static document uses — it cannot
 * carry the live state, so it merges into the last canonical hash instead of replacing it. These
 * pin the merge (state kept, panes added, last named pane active) and its edges (flag suffix on
 * the active id, the boot self-base, non-open passthrough).
 */
import { describe, expect, it } from "vitest";
import { canonicalizeArrival, hashParams, pageAddress, setOffline } from "./view-hash.js";

describe("canonicalizeArrival", () => {
	const base = "#?label=File&sort=dateModified&col=shu-monitor-column&active=shu-monitor-column";

	it("a hash without open= is already canonical and passes through untouched", () => {
		expect(canonicalizeArrival(base, "")).toBe(base);
		expect(canonicalizeArrival("", base)).toBe("");
	});

	it("merges open= panes into the base, keeping its state and activating the linked view", () => {
		const p = hashParams(canonicalizeArrival("#?open=shu-graph-view", base));
		expect(p.get("label")).toBe("File");
		expect(p.get("sort")).toBe("dateModified");
		expect(p.getAll("col")).toEqual(["shu-monitor-column", "shu-graph-view"]);
		expect(p.get("active")).toBe("shu-graph-view");
		expect(p.get("open")).toBeNull();
	});

	it("several open= entries all become col= entries; the last one is active, its flag suffix stripped", () => {
		const p = hashParams(canonicalizeArrival("#?open=shu-graph-view&open=shu-document-column~min", ""));
		expect(p.getAll("col")).toEqual(["shu-graph-view", "shu-document-column~min"]);
		expect(p.get("active")).toBe("shu-document-column");
	});

	it("at boot the arrival is its own merge base: open= converts without duplicating itself", () => {
		const boot = "#?label=File&open=shu-graph-view";
		const p = hashParams(canonicalizeArrival(boot, boot));
		expect(p.get("label")).toBe("File");
		expect(p.getAll("col")).toEqual(["shu-graph-view"]);
		expect(p.get("open")).toBeNull();
	});
});

describe("pageAddress", () => {
	it("is the page address without its fragment online, and empty offline (a snapshot has no servable address)", () => {
		setOffline(false);
		expect(pageAddress()).toBe(location.origin + location.pathname + location.search);
		setOffline(true);
		expect(pageAddress()).toBe("");
		setOffline(false);
	});
});
