/** The last response as the steps that read it count it: its JSON list, or the members a filter kept. */
import { describe, expect, it } from "vitest";
import type { TFeatureStep } from "@haibun/core/lib/astepper.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { RESPONSE_LISTS } from "../domains/web-playwright.js";
import { filterResponse, keepResponse, responseLengthIs } from "./rest.js";

const step = {
	in: "a request",
	seqPath: [0, 1, 1],
	action: { actionName: "restEndpointRequest", stepperName: "WebPlaywright", step: { gwta: "a request" } },
} as unknown as TFeatureStep;
const response = { status: 200, statusText: "OK", headers: {}, url: "http://localhost/items", text: "", json: [{ name: "ant" }, { name: "bee" }, { name: "anchor" }] };

describe("the response-length step's count", () => {
	it("counts the JSON list, and the members a filter kept", async () => {
		const world = getDefaultWorld();
		await keepResponse(world, response, step);
		expect((await responseLengthIs(world, RESPONSE_LISTS.json, 3)).ok).toBe(true);
		expect(await responseLengthIs(world, RESPONSE_LISTS.json, 2)).toMatchObject({ ok: false, errorMessage: "Expected 2, got 3" });
		expect(await responseLengthIs(world, RESPONSE_LISTS.filtered, 2), "before a filter").toMatchObject({ ok: false });
		await filterResponse(world, step, "name", "^an");
		expect((await responseLengthIs(world, RESPONSE_LISTS.filtered, 2)).ok).toBe(true);
	});

	it("refuses a count of a response whose body isn't a JSON list", async () => {
		const world = getDefaultWorld();
		await keepResponse(world, { ...response, json: { name: "ant" } }, step);
		expect(await responseLengthIs(world, RESPONSE_LISTS.json, 1)).toMatchObject({ ok: false, errorMessage: "the last response doesn't hold a JSON list to count" });
	});
});
