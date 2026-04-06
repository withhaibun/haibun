import { describe, it, expect } from "vitest";
import { RpcRequestSchema, RpcResponseSchema, RpcStreamSchema, parseRpcRequest } from "./step-dispatch.js";

describe("JSON-RPC 2.0 schema compliance", () => {
	it("accepts valid jsonrpc 2.0 request", () => {
		const result = RpcRequestSchema.safeParse({
			jsonrpc: "2.0",
			id: "1",
			method: "GraphStepper-getLabelRels",
			params: { label: "Email" },
		});
		expect(result.success).toBe(true);
	});

	it("rejects old-format request with type field", () => {
		const result = RpcRequestSchema.safeParse({
			type: "rpc",
			id: "1",
			method: "GraphStepper-getLabelRels",
			params: { label: "Email" },
		});
		expect(result.success).toBe(false);
	});

	it("rejects request without jsonrpc field", () => {
		const result = RpcRequestSchema.safeParse({
			id: "1",
			method: "test",
		});
		expect(result.success).toBe(false);
	});

	it("parseRpcRequest returns null for non-standard envelope", () => {
		expect(parseRpcRequest({ type: "rpc", id: "1", method: "test" })).toBeNull();
	});

	it("parseRpcRequest returns parsed request for valid envelope", () => {
		const result = parseRpcRequest({ jsonrpc: "2.0", id: "1", method: "test" });
		expect(result).not.toBeNull();
		expect(result?.jsonrpc).toBe("2.0");
		expect(result?.method).toBe("test");
	});

	it("accepts request with stream flag", () => {
		const result = RpcRequestSchema.safeParse({
			jsonrpc: "2.0",
			id: "1",
			method: "test",
			stream: true,
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.stream).toBe(true);
	});

	it("accepts request with capability", () => {
		const result = RpcRequestSchema.safeParse({
			jsonrpc: "2.0",
			id: "1",
			method: "test",
			capability: "Test:*",
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.capability).toBe("Test:*");
	});

	it("defaults params to empty object", () => {
		const result = RpcRequestSchema.safeParse({
			jsonrpc: "2.0",
			id: "1",
			method: "test",
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.params).toEqual({});
	});

	it("validates response schema", () => {
		const result = RpcResponseSchema.safeParse({
			jsonrpc: "2.0",
			id: "1",
			result: { rels: { messageId: "item" } },
		});
		expect(result.success).toBe(true);
	});

	it("validates stream chunk schema", () => {
		const result = RpcStreamSchema.safeParse({
			jsonrpc: "2.0",
			id: "1",
			stream: true,
			data: { chunk: "text" },
		});
		expect(result.success).toBe(true);
	});
});
