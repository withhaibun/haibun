// @vitest-environment jsdom
/**
 * Arrival canonicalization: `open=` is the ADDITIVE link form a static document uses — it cannot
 * carry the live state, so it merges into the last canonical hash instead of replacing it. These
 * pin the merge (state kept, panes added, last named pane active) and its edges (flag suffix on
 * the active id, the boot self-base, non-open passthrough).
 */
import { describe, expect, it } from "vitest";
import { canonicalizeArrival, hashParam, hashParams, mergeHashParams, onHashChanged, pageAddress, pushHash } from "./view-hash.js";
import { setConduit, resetConduit, SerializedConduit, LiveConduit } from "./hypermedia.js";

describe("canonicalizeArrival", () => {
	const base = "#?label=File&sort=dateModified&col=shu-monitor-column&active=shu-monitor-column";

	it("a hash without open= is already canonical and passes through untouched", () => {
		expect(canonicalizeArrival(base, "")).toBe(base);
		expect(canonicalizeArrival("", base)).toBe("");
	});

	it("merges open= panes into the base, keeping its state and activating the linked view", () => {
		const p = hashParams(canonicalizeArrival("#?open=shu-polymorphic-graph-view", base));
		expect(p.get("label")).toBe("File");
		expect(p.get("sort")).toBe("dateModified");
		expect(p.getAll("col")).toEqual(["shu-monitor-column", "shu-polymorphic-graph-view"]);
		expect(p.get("active")).toBe("shu-polymorphic-graph-view");
		expect(p.get("open")).toBeNull();
	});

	it("several open= entries all become col= entries; the last one is active, its flag suffix stripped", () => {
		const p = hashParams(canonicalizeArrival("#?open=shu-polymorphic-graph-view&open=shu-document-column~min", ""));
		expect(p.getAll("col")).toEqual(["shu-polymorphic-graph-view", "shu-document-column~min"]);
		expect(p.get("active")).toBe("shu-document-column");
	});

	it("at boot the arrival is its own merge base: open= converts without duplicating itself", () => {
		const boot = "#?label=File&open=shu-polymorphic-graph-view";
		const p = hashParams(canonicalizeArrival(boot, boot));
		expect(p.get("label")).toBe("File");
		expect(p.getAll("col")).toEqual(["shu-polymorphic-graph-view"]);
		expect(p.get("open")).toBeNull();
	});
});

describe("pageAddress", () => {
	it("is the page address without its fragment online, and empty offline (a snapshot has no servable address)", () => {
		setConduit(new LiveConduit(""));
		expect(pageAddress()).toBe(location.origin + location.pathname + location.search);
		resetConduit();
		setConduit(new SerializedConduit(() => { throw new Error("view-hash test: no dispatch expected"); }));
		expect(pageAddress()).toBe("");
		resetConduit();
	});
});

describe("params a view writes into the hash", () => {
	it("keeps every param it was not asked about, and an empty value removes one", () => {
		pushHash("#?label=File&aff-goal=vc");
		mergeHashParams({ "aff-waypoint": "VC issued" });
		expect(hashParam("label"), "the rest of the view state is untouched").toBe("File");
		expect(hashParam("aff-waypoint")).toBe("VC issued");
		mergeHashParams({ "aff-goal": "", "aff-waypoint": "" });
		expect(hashParam("aff-goal")).toBe("");
		expect(hashParam("label"), "and removing a deep link is not a reset").toBe("File");
	});

	it("tells the views reading it that it moved, since writing the hash raises no event of its own", () => {
		pushHash("#?");
		let announced = 0;
		const heard = onHashChanged(() => announced++);
		mergeHashParams({ "aff-goal": "vc" });
		expect(announced).toBe(1);
		mergeHashParams({ "aff-goal": "vc" });
		expect(announced, "writing what is already there says nothing").toBe(1);
		heard();
		mergeHashParams({ "aff-goal": "other" });
		expect(announced, "and a view that has gone hears nothing").toBe(1);
	});

	it("round-trips in a snapshot saved for reading offline, where there is no address to write to", () => {
		setConduit(new SerializedConduit(() => { throw new Error("view-hash test: no dispatch expected"); }));
		pushHash("#?");
		let announced = 0;
		const heard = onHashChanged(() => announced++);
		mergeHashParams({ "aff-goal": "vc" });
		expect(hashParam("aff-goal"), "the report keeps its own view state").toBe("vc");
		expect(announced, "and its views hear the deep link the same way").toBe(1);
		heard();
		resetConduit();
	});
});
