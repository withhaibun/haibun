// A read doesn't leave a record. The browser observer traces and observes the page's requests; a request that asks actuality
// to read isn't traced or observed, as actuality doesn't record or narrate it. An observed read returns to the page as graph data,
// and a page that records what it draws then draws what it recorded.
import { describe, expect, it } from "vitest";
import { asksToRead, isHttpExchange } from "./PlaywrightEvents.js";
import { newActualityId, rpcEnvelope } from "@haibun/core/lib/rpc-wire.js";

const call = (asks?: "read" | "act") =>
	rpcEnvelope({ id: "rpc-1", method: "MonitorStepper-recordClientBlips", params: { batch: {} }, actualityId: newActualityId(), ...(asks ? { asks } : {}) });

describe("what the browser observer leaves unrecorded", () => {
	it("a load of a blob or data URL", () => {
		expect(isHttpExchange("blob:https://example.com/be63d364-0d27-4c1f-9d4e-4f5c2f8c0a11")).toBe(false);
		expect(isHttpExchange("data:image/png;base64,iVBORw0KGgo=")).toBe(false);
		expect(isHttpExchange("https://example.com/page")).toBe(true);
		expect(isHttpExchange("http://192.0.2.1:8080/page")).toBe(true);
	});

	it("a call that asks to read", () => {
		expect(asksToRead("POST", call("read"))).toBe(true);
	});

	it("not a call that acts, a call that doesn't state what it asks, a page load, or a body that is not a call", () => {
		expect(asksToRead("POST", call("act"))).toBe(false);
		expect(asksToRead("POST", call())).toBe(false);
		expect(asksToRead("GET", null)).toBe(false);
		expect(asksToRead("POST", "not json")).toBe(false);
		expect(asksToRead("POST", JSON.stringify({ asks: "read" })), "asks alone is not a call").toBe(false);
	});
});
