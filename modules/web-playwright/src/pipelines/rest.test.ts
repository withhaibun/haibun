/** The last response as a read of its JSON members lists it. */
import { describe, expect, it } from "vitest";
import type { TFeatureStep } from "@haibun/core/lib/astepper.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { jsonResponse, keepResponse } from "./rest.js";

const step = {
	in: "a request",
	seqPath: [0, 1, 1],
	action: { actionName: "restEndpointRequest", stepperName: "WebPlaywright", step: { gwta: "a request" } },
} as unknown as TFeatureStep;
const response = { status: 200, statusText: "OK", headers: {}, url: "http://localhost/items", text: "", json: [{ name: "ant" }, { name: "bee" }, { name: "anchor" }] };

describe("the members of the last JSON response", () => {
	it("are a counted list", async () => {
		const world = getDefaultWorld();
		await keepResponse(world, response, step);
		expect(await jsonResponse(world)).toEqual({ ok: true, products: { members: response.json, total: 3, saturated: false } });
	});

	it("are refused where the response's body isn't a JSON list", async () => {
		const world = getDefaultWorld();
		await keepResponse(world, { ...response, json: { name: "ant" } }, step);
		expect(await jsonResponse(world)).toMatchObject({ ok: false, errorMessage: expect.stringContaining("the last response isn't a JSON list of members") });
	});
});
