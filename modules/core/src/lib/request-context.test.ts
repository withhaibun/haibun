import { describe, it, expect } from "vitest";
import { requestBaseIri, sentByAnotherSite, runWithRequestContext, currentRequestBaseIri } from "./request-context.js";

describe("requestBaseIri", () => {
	it("prefers the forwarding headers a reverse proxy sets", () => {
		expect(requestBaseIri({ "x-forwarded-proto": "https", "x-forwarded-host": "example.org", host: "127.0.0.1:8223" })).toBe("https://example.org");
	});
	it("reads the Host header, defaulting the scheme to http", () => {
		expect(requestBaseIri({ host: "192.0.2.9:8223" })).toBe("http://192.0.2.9:8223");
	});
	it("takes the first value of a comma-joined forwarding chain", () => {
		expect(requestBaseIri({ "x-forwarded-proto": "https, http", "x-forwarded-host": "front.example, back.internal" })).toBe("https://front.example");
	});
	it("is undefined when a host isn't present", () => {
		expect(requestBaseIri({})).toBeUndefined();
		expect(requestBaseIri()).toBeUndefined();
	});
});

describe("sentByAnotherSite", () => {
	const HOST = "192.0.2.9:8223";

	it("is false for a request that doesn't state an Origin, as a process sends one", () => {
		expect(sentByAnotherSite({ host: HOST })).toBe(false);
	});
	it("is false for a page of this site, reached directly or through a proxy", () => {
		expect(sentByAnotherSite({ host: HOST, origin: `http://${HOST}` })).toBe(false);
		expect(sentByAnotherSite({ host: "127.0.0.1:8223", "x-forwarded-host": "example.org", origin: "https://example.org" })).toBe(false);
	});
	it("is true for a page of another site, and for an Origin that isn't an address", () => {
		expect(sentByAnotherSite({ host: HOST, origin: "https://elsewhere.example" })).toBe(true);
		expect(sentByAnotherSite({ host: HOST, origin: "null" })).toBe(true);
	});
});

describe("request context", () => {
	it("exposes the base IRI within the scope, undefined outside it", () => {
		expect(currentRequestBaseIri()).toBeUndefined();
		runWithRequestContext({ baseIri: "http://192.0.2.9:8223" }, () => {
			expect(currentRequestBaseIri()).toBe("http://192.0.2.9:8223");
		});
		expect(currentRequestBaseIri()).toBeUndefined();
	});
});
