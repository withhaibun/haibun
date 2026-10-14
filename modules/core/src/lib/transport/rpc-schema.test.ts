import { describe, it, expect } from "vitest";
import { ACTION_BEGIN, RPC_PROTOCOL, RpcRequestSchema, RpcResponseSchema, RpcStreamSchema, actualityRefusal, parseRpcRequest } from "./ports.js";

const ACTUALITY = crypto.randomUUID();

describe("JSON-RPC 2.0 schema compliance", () => {
	it("accepts valid jsonrpc 2.0 request", () => {
		const result = RpcRequestSchema.safeParse({
			jsonrpc: "2.0",
			protocol: RPC_PROTOCOL,
			id: "1",
			method: "RemoteSteps-getLabelRels",
			params: { label: "Letter" },
			actualityId: ACTUALITY,
		});
		expect(result.success).toBe(true);
	});

	it("rejects a request with a `type` field in place of `jsonrpc`", () => {
		const result = RpcRequestSchema.safeParse({ type: "rpc", id: "1", method: "RemoteSteps-getLabelRels", params: { label: "Letter" } });
		expect(result.success).toBe(false);
	});

	it("rejects request without jsonrpc field", () => {
		const result = RpcRequestSchema.safeParse({ id: "1", method: "test" });
		expect(result.success).toBe(false);
	});

	it("parseRpcRequest refuses a non-standard envelope", () => {
		expect(parseRpcRequest({ type: "rpc", id: "1", method: "test" }, ACTUALITY).success).toBe(false);
	});

	it("parses a call that states the actuality the host holds, and a handshake that doesn't state an actuality", () => {
		const parsed = parseRpcRequest({ jsonrpc: "2.0", protocol: RPC_PROTOCOL, id: "1", method: "test", params: {}, actualityId: ACTUALITY }, ACTUALITY);
		expect(parsed.success && parsed.data.method).toBe("test");
		expect(parseRpcRequest({ jsonrpc: "2.0", protocol: RPC_PROTOCOL, id: "1", method: ACTION_BEGIN, params: {} }, ACTUALITY).success).toBe(true);
	});

	it("refuses a call that doesn't state the host's actuality, with a refusal that names the host's actuality", () => {
		expect(parseRpcRequest({ jsonrpc: "2.0", protocol: RPC_PROTOCOL, id: "1", method: "test" }, ACTUALITY).success, "a call that doesn't state one").toBe(false);
		const stated = crypto.randomUUID();
		const other = parseRpcRequest({ jsonrpc: "2.0", protocol: RPC_PROTOCOL, id: "1", method: "test", actualityId: stated }, ACTUALITY);
		expect(other.success ? undefined : other.refusal.error).toContain(actualityRefusal(stated, ACTUALITY)?.error);
	});

	it("accepts request with stream flag", () => {
		const result = RpcRequestSchema.safeParse({ jsonrpc: "2.0", protocol: RPC_PROTOCOL, id: "1", method: "test", params: {}, stream: true, actualityId: ACTUALITY });
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.stream).toBe(true);
	});

	it("accepts request with capability", () => {
		const result = RpcRequestSchema.safeParse({ jsonrpc: "2.0", protocol: RPC_PROTOCOL, id: "1", method: "test", params: {}, capability: "Test:*", actualityId: ACTUALITY });
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.capability).toBe("Test:*");
	});

	it("refuses a call that doesn't state its params, since a call to a step without arguments states an empty record", () => {
		expect(RpcRequestSchema.safeParse({ jsonrpc: "2.0", protocol: RPC_PROTOCOL, id: "1", method: "test", actualityId: ACTUALITY }).success).toBe(false);
		expect(RpcRequestSchema.safeParse({ jsonrpc: "2.0", protocol: RPC_PROTOCOL, id: "1", method: "test", params: {}, actualityId: ACTUALITY }).success).toBe(true);
	});

	it("validates response schema", () => {
		const result = RpcResponseSchema.safeParse({ jsonrpc: "2.0", protocol: RPC_PROTOCOL, id: "1", result: { rels: { messageId: "item" } } });
		expect(result.success).toBe(true);
	});

	it("validates stream chunk schema", () => {
		const result = RpcStreamSchema.safeParse({ jsonrpc: "2.0", protocol: RPC_PROTOCOL, id: "1", stream: true, data: { chunk: "text" } });
		expect(result.success).toBe(true);
	});
});
