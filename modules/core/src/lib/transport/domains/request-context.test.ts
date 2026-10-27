import { describe, it, expect } from "vitest";
import { requestBaseIri, sentByAnotherSite, runWithRequestContext, currentRequestBaseIri } from "./request-context.js";

const ORIGIN = "https://example.org";
const ORIGINS = [ORIGIN];

describe("requestBaseIri", () => {
	it("is the configured origin a reverse proxy's forwarded host names, with the scheme the origin states", () => {
		expect(requestBaseIri({ "x-forwarded-proto": "http", "x-forwarded-host": "example.org", host: "127.0.0.1:8223" }, ORIGINS)).toBe(ORIGIN);
		expect(requestBaseIri({ "x-forwarded-host": "example.org, back.internal" }, ORIGINS), "the first of a forwarding chain").toBe(ORIGIN);
	});
	it("ignores a forwarded host that doesn't name a configured origin, since a caller that reaches the server directly writes it", () => {
		expect(requestBaseIri({ "x-forwarded-proto": "https", "x-forwarded-host": "rebound.example", host: "127.0.0.1:8223" }, ORIGINS)).toBe("http://127.0.0.1:8223");
		expect(requestBaseIri({ "x-forwarded-host": "example.org", host: "127.0.0.1:8223" }, []), "a server that doesn't name origins").toBe("http://127.0.0.1:8223");
	});
	it("is the configured origin the Host header names, else plain HTTP at that host", () => {
		expect(requestBaseIri({ host: "example.org" }, ORIGINS)).toBe(ORIGIN);
		expect(requestBaseIri({ host: "192.0.2.9:8223" }, ORIGINS)).toBe("http://192.0.2.9:8223");
	});
	it("is undefined when a host isn't present", () => {
		expect(requestBaseIri({}, ORIGINS)).toBeUndefined();
		expect(requestBaseIri(undefined, ORIGINS)).toBeUndefined();
	});
});

describe("sentByAnotherSite", () => {
	const HOST = "192.0.2.9:8223";

	it("is false for a request that doesn't state an Origin, as a process sends one", () => {
		expect(sentByAnotherSite({ host: HOST }, ORIGINS)).toBe(false);
	});
	it("is false for a page of this site, reached directly or through a proxy that forwards a configured origin's host", () => {
		expect(sentByAnotherSite({ host: HOST, origin: `http://${HOST}` }, ORIGINS)).toBe(false);
		expect(sentByAnotherSite({ host: "127.0.0.1:8223", "x-forwarded-host": "example.org", origin: ORIGIN }, ORIGINS)).toBe(false);
	});
	it("is true for a page of another site, for one whose forwarded host names an unconfigured host, and for an Origin that isn't an address", () => {
		expect(sentByAnotherSite({ host: HOST, origin: "https://elsewhere.example" }, ORIGINS)).toBe(true);
		expect(sentByAnotherSite({ host: HOST, "x-forwarded-host": "elsewhere.example", origin: "https://elsewhere.example" }, ORIGINS)).toBe(true);
		expect(sentByAnotherSite({ host: HOST, origin: "null" }, ORIGINS)).toBe(true);
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
