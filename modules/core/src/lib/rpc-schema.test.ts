import { describe, it, expect } from "vitest";
import { ACTION_BEGIN, RpcRequestSchema, RpcResponseSchema, RpcStreamSchema, parseRpcRequest } from "./rpc-wire.js";

const ACTUALITY = crypto.randomUUID();

describe("JSON-RPC 2.0 schema compliance", () => {
	it("accepts valid jsonrpc 2.0 request", () => {
		const result = RpcRequestSchema.safeParse({
			jsonrpc: "2.0",
			id: "1",
			method: "RemoteSteps-getLabelRels",
			params: { label: "Email" },
			actualityId: ACTUALITY,
		});
		expect(result.success).toBe(true);
	});

	it("rejects old-format request with type field", () => {
		const result = RpcRequestSchema.safeParse({
			type: "rpc",
			id: "1",
			method: "RemoteSteps-getLabelRels",
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

	it("parseRpcRequest refuses a non-standard envelope", () => {
		expect(parseRpcRequest({ type: "rpc", id: "1", method: "test" }, ACTUALITY).success).toBe(false);
	});

	it("parses a call stating the actuality the host holds, and the handshake, which states none", () => {
		const parsed = parseRpcRequest({ jsonrpc: "2.0", id: "1", method: "test", actualityId: ACTUALITY }, ACTUALITY);
		expect(parsed.success && parsed.data.method).toBe("test");
		expect(parseRpcRequest({ jsonrpc: "2.0", id: "1", method: ACTION_BEGIN }, ACTUALITY).success).toBe(true);
	});

	it("refuses a call that doesn't state the actuality the host holds, naming the one it holds", () => {
		expect(parseRpcRequest({ jsonrpc: "2.0", id: "1", method: "test" }, ACTUALITY).success, "a call that doesn't state one").toBe(false);
		const other = parseRpcRequest({ jsonrpc: "2.0", id: "1", method: "test", actualityId: crypto.randomUUID() }, ACTUALITY);
		expect(other.success ? undefined : other.refusal.error).toContain(`this instance holds actuality ${ACTUALITY}`);
	});

	it("accepts request with stream flag", () => {
		const result = RpcRequestSchema.safeParse({
			jsonrpc: "2.0",
			id: "1",
			method: "test",
			stream: true,
			actualityId: ACTUALITY,
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
			actualityId: ACTUALITY,
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.capability).toBe("Test:*");
	});

	it("defaults params to empty object", () => {
		const result = RpcRequestSchema.safeParse({
			jsonrpc: "2.0",
			id: "1",
			method: "test",
			actualityId: ACTUALITY,
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
