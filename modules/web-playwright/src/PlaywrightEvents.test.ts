// A read leaves no record. The browser observer traces and observes the page's requests; a request that asks the run
// to read is neither, as the run neither records nor narrates it. Observed, a page's own reads came back to it as graph
// data and a page that recorded what it drew drew what it recorded, without end.
import { describe, expect, it } from "vitest";
import { asksToRead } from "./PlaywrightEvents.js";

const call = (asks?: "read" | "act") =>
	JSON.stringify({ jsonrpc: "2.0", id: "rpc-1", method: "MonitorStepper-recordClientBlips", params: { batch: {} }, ...(asks ? { asks } : {}) });

describe("what the browser observer leaves unrecorded", () => {
	it("a call that asks to read", () => {
		expect(asksToRead("POST", call("read"))).toBe(true);
	});

	it("not a call that acts, nor one that says nothing, nor a page load, nor a body that is not a call", () => {
		expect(asksToRead("POST", call("act"))).toBe(false);
		expect(asksToRead("POST", call())).toBe(false);
		expect(asksToRead("GET", null)).toBe(false);
		expect(asksToRead("POST", "not json")).toBe(false);
		expect(asksToRead("POST", JSON.stringify({ asks: "read" })), "asks alone is not a call").toBe(false);
	});
});
