import { describe, it, expect } from "vitest";
import { isServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import { carriedConduit } from "./carried-conduit.js";
import { acts, reads } from "../domains/links.js";

describe("the conduit of a page that carries a record of actuality", () => {
	it("fails each call as a call to a site that doesn't respond, so each read reads what the page carries", async () => {
		const conduit = carriedConduit();
		const refusals = await Promise.all([
			conduit.follow(reads("GraphStepper-graphQuery"), "a read").catch((err: unknown) => err),
			conduit.followStream(acts("LlmStepper-ask"), () => undefined, { why: "a stream" }).catch((err: unknown) => err),
			conduit.group("an act", () => Promise.resolve()).catch((err: unknown) => err),
		]);
		for (const refusal of refusals) expect(isServerUnreachable(refusal), String(refusal)).toBe(true);
		expect(String(refusals[0])).toMatch(/GraphStepper-graphQuery: a page that carries a record of actuality isn't served by a site/);
	});
});
