import { describe, it, expect } from "vitest";
import { requestBaseIri, runWithRequestContext, currentRequestBaseIri } from "./request-context.js";

describe("requestBaseIri", () => {
	it("prefers the forwarding headers a reverse proxy sets", () => {
		expect(requestBaseIri({ "x-forwarded-proto": "https", "x-forwarded-host": "example.org", host: "127.0.0.1:8223" })).toBe("https://example.org");
	});
	it("falls back to the Host header, defaulting the scheme to http", () => {
		expect(requestBaseIri({ host: "192.168.1.9:8223" })).toBe("http://192.168.1.9:8223");
	});
	it("takes the first value of a comma-joined forwarding chain", () => {
		expect(requestBaseIri({ "x-forwarded-proto": "https, http", "x-forwarded-host": "front.example, back.internal" })).toBe("https://front.example");
	});
	it("is undefined when no host is present", () => {
		expect(requestBaseIri({})).toBeUndefined();
		expect(requestBaseIri()).toBeUndefined();
	});
});

describe("request context", () => {
	it("exposes the base IRI within the scope, undefined outside it", () => {
		expect(currentRequestBaseIri()).toBeUndefined();
		runWithRequestContext({ baseIri: "http://192.168.1.9:8223" }, () => {
			expect(currentRequestBaseIri()).toBe("http://192.168.1.9:8223");
		});
		expect(currentRequestBaseIri()).toBeUndefined();
	});
});
