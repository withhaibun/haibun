import { describe, it, expect } from "vitest";
import { carriedInSignature, carriedSignature, readFromAuthorization, SIGNATURE_HEADER } from "./signature-header.js";

const PARAMS = 'keyId="did:key:zReader#zReader",headers="(request-target) host",signature="abc"';
const BASIC = "Basic cmVhZGVyOnBhc3N3b3Jk";

describe("where a signed request carries its signature", () => {
	it("is the Signature header, so Authorization stays with whatever admits a person to the site", () => {
		const sent = carriedInSignature({ authorization: `Signature ${PARAMS}`, host: "site.test" });
		expect(sent).toEqual({ [SIGNATURE_HEADER]: PARAMS, host: "site.test" });
	});

	it("refuses signed headers that don't carry a signature", () => {
		expect(() => carriedInSignature({ host: "site.test" })).toThrow(/don't carry a signature/);
	});

	it("is read beside the Authorization a proxy's sign-in wrote, which a verifying library doesn't read", () => {
		const arrived = { Signature: PARAMS, authorization: BASIC, host: "site.test" };
		expect(carriedSignature(arrived)).toBe(PARAMS);
		expect(readFromAuthorization(arrived)).toEqual({ authorization: `Signature ${PARAMS}`, host: "site.test" });
	});

	it("doesn't read a request that carries only a proxy's Authorization as signed", () => {
		expect(readFromAuthorization({ authorization: BASIC, host: "site.test" })).toEqual({ host: "site.test" });
	});
});
