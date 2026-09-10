// @vitest-environment jsdom
/**
 * A reference is a link in the plain HTML sense, an anchor with a real href, so the browser gives it focus, a new
 * tab, a copyable address, and a status-bar preview. The href addresses the ONE thing referred to, not the reader's
 * trail of columns.
 */
import { describe, expect, it } from "vitest";
import { desiredPaneFor, refHref } from "./ref-navigation.js";

describe("refHref", () => {
	it("addresses one column view, not the reader's trail of columns", () => {
		const href = refHref("domain", { domain: "Principal" });
		expect(href).toBe("#?col=type%3APrincipal");
		expect(href?.match(/col=/g)).toHaveLength(1);
	});

	it("addresses an individual and a step's quads", () => {
		expect(refHref("entity", { persistedAs: "Person", id: "ada@test.com" })).toContain("col=");
		expect(refHref("seqPath", { seqPath: [0, 1, 2] })).toContain("col=");
	});

	it("addresses exactly the pane a click opens: one reading of (kind, target) serves both, so they cannot drift", () => {
		expect(desiredPaneFor("domain", { domain: "Principal" })).toEqual({ paneType: "type", persistedAs: "Principal" });
		expect(desiredPaneFor("entity", { persistedAs: "Person", id: "ada@test.com" })).toEqual({ paneType: "entity", persistedAs: "Person", id: "ada@test.com" });
		expect(desiredPaneFor("step", { stepperName: "S", stepName: "s" })).toBeNull();
	});

	it("is no link at all for a kind with no pane, rather than one that goes nowhere", () => {
		expect(refHref("step", { stepperName: "S", stepName: "s" })).toBeUndefined();
		expect(refHref("domain", {})).toBeUndefined();
	});
});
