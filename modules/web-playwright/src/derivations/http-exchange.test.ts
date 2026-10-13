/**
 * The requests the browser observer records. A read doesn't leave a record: a call whose envelope states that it reads isn't
 * traced or observed, as actuality doesn't record or narrate it.
 */
import { describe, expect, it } from "vitest";
import { asksToRead, isHttpExchange, isRecorded } from "./http-exchange.js";
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

	it("a call whose envelope states that it reads", () => {
		expect(asksToRead("POST", call("read"))).toBe(true);
	});

	it("leaves out a call that acts, a call without the field, a page load, and a body other than a call", () => {
		expect(asksToRead("POST", call("act"))).toBe(false);
		expect(asksToRead("POST", call())).toBe(false);
		expect(asksToRead("GET", undefined)).toBe(false);
		expect(asksToRead("POST", "not json")).toBe(false);
		expect(asksToRead("POST", JSON.stringify({ asks: "read" })), "the field alone isn't a call").toBe(false);
	});

	it("records an HTTP exchange that acts, and leaves a read and a load of a data URL", () => {
		const request = { method: "POST", headers: {}, frameUrl: "https://example.com/", pageUrl: "https://example.com/" };
		expect(isRecorded({ ...request, url: "https://example.com/rpc", postData: call("act") })).toBe(true);
		expect(isRecorded({ ...request, url: "https://example.com/rpc", postData: call("read") })).toBe(false);
		expect(isRecorded({ ...request, url: "data:text/plain,hi" })).toBe(false);
	});
});
