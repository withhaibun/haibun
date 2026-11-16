/** A response's JSON members as the `show JSON response of` step lists them. */
import { describe, expect, it } from "vitest";
import { Origin } from "@haibun/core/lib/domains/protocol.js";
import { jsonResponse } from "./rest.js";

const response = { status: 200, statusText: "OK", headers: {}, url: "http://localhost/items", text: "", json: [{ name: "ant" }, { name: "bee" }, { name: "anchor" }] };
const value = (json: unknown) => ({ term: "response", domain: "json", value: json, origin: Origin.var });

describe("the members of a JSON response", () => {
	it("are a counted list", async () => {
		expect(await jsonResponse(value(response.json))).toEqual({ ok: true, products: { members: response.json, total: 3, saturated: false } });
	});

	it("are refused where the response's body isn't a JSON list", async () => {
		expect(await jsonResponse(value({ name: "ant" }))).toMatchObject({ ok: false, errorMessage: expect.stringContaining("the response isn\'t a JSON list of members") });
	});
});
