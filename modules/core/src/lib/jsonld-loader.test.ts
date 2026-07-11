import { describe, it, expect, beforeEach } from "vitest";
import { registerContext, registerKeyDocument, clearKeyDocuments, setNetworkResolver, documentLoader } from "./jsonld-loader.js";

describe("jsonld-loader — local registry with opt-in network", () => {
	beforeEach(() => {
		clearKeyDocuments();
		setNetworkResolver(undefined);
	});

	it("resolves a key document ahead of a same-URL context, and clears keys without dropping contexts", async () => {
		registerContext("urn:doc", { from: "context" });
		registerKeyDocument("urn:doc", { from: "key" });
		expect((await documentLoader("urn:doc")).document).toEqual({ from: "key" });
		clearKeyDocuments();
		expect((await documentLoader("urn:doc")).document).toEqual({ from: "context" });
	});

	it("uses the injected network resolver only for URLs absent from the registry, and throws when none is set", async () => {
		registerContext("urn:local", { local: true });
		await expect(documentLoader("urn:remote")).rejects.toThrow(/no network resolver/i);
		setNetworkResolver(async (url) => ({ contextUrl: null, documentUrl: url, document: { remote: true } }));
		expect((await documentLoader("urn:local")).document).toEqual({ local: true });
		expect((await documentLoader("urn:remote")).document).toEqual({ remote: true });
	});
});
