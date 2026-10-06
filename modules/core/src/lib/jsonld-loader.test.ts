import { describe, it, expect, beforeEach } from "vitest";
import { registerContext, registerKeyDocument, clearKeyDocuments, documentLoader } from "./jsonld-loader.js";

describe("jsonld-loader, a registry without a network", () => {
	beforeEach(() => {
		clearKeyDocuments();
	});

	it("resolves a key document ahead of a same-URL context, and clears keys without dropping contexts", async () => {
		registerContext("urn:doc", { from: "context" });
		registerKeyDocument("urn:doc", { from: "key" });
		expect((await documentLoader("urn:doc")).document).toEqual({ from: "key" });
		clearKeyDocuments();
		expect((await documentLoader("urn:doc")).document).toEqual({ from: "context" });
	});

	it("throws for a URL it doesn't hold, rather than reaching the network", async () => {
		await expect(documentLoader("https://example.com/unregistered")).rejects.toThrow(/isn't registered/);
	});
});
