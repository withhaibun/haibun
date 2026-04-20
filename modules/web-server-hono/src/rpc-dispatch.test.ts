import { describe, it, expect } from "vitest";
import { passWithDefaults, DEF_PROTO_OPTIONS } from "@haibun/core/lib/test/lib.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { OK, type TStepArgs } from "@haibun/core/schema/protocol.js";
import { actionNotOK, actionOKWithProducts, getStepperOptionName } from "@haibun/core/lib/util/index.js";
import ZcapLikeStepper from "@haibun/core/steps/zcap-like-stepper.js";
import WebServerStepper from "./web-server-stepper.js";

class PingStepper extends AStepper {
	steps = {
		ping: {
			gwta: "ping",
			action: async () => actionOKWithProducts({ pong: true }),
		},
		protectedPing: {
			gwta: "protected ping",
			capability: "PingStepper:protected",
			action: async () => actionOKWithProducts({ protected: true }),
		},
		adminPing: {
			gwta: "admin ping",
			capability: "PingStepper:admin",
			action: async () => actionOKWithProducts({ admin: true }),
		},
	};
}

class RpcVerifyStepper extends AStepper {
	steps = {
		rpcStepListIncludes: {
			gwta: "rpc step list at {url} includes {stepName}",
			action: async ({ url, stepName }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "step.list", params: {} }),
				});
				if (!res.ok) return actionNotOK(`HTTP ${res.status}`);
				const data = await res.json();
				const steps = Array.isArray(data) ? data : ((data as { steps?: { method: string }[] }).steps ?? []);
				const methods = steps.map((s: { method: string }) => s.method);
				return methods.includes(String(stepName)) ? OK : actionNotOK(`"${stepName}" not in [${methods.join(", ")}]`);
			},
		},
		rpcCallSucceeds: {
			gwta: "rpc call to {url} with method {method} succeeds",
			action: async ({ url, method }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: String(method), params: {}, seqPath: [0, 1, 1, 1] }),
				});
				if (!res.ok) return actionNotOK(`HTTP ${res.status}`);
				const data = await res.json();
				if (data.error) return actionNotOK(data.error);
				return OK;
			},
		},
		rpcCallDeniedWithoutCapability: {
			gwta: "rpc call to {url} with method {method} is denied without capability",
			action: async ({ url, method }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: String(method), params: {}, seqPath: [0, 1, 1, 1] }),
				});
				const data = await res.json();
				if (res.status !== 422) return actionNotOK(`Expected HTTP 422, got ${res.status}`);
				if (typeof data.error !== "string" || !data.error.includes("capability PingStepper:protected required")) {
					return actionNotOK(`Expected capability error, got ${JSON.stringify(data)}`);
				}
				return OK;
			},
		},
		rpcCallSucceedsWithBearerToken: {
			gwta: "rpc call to {url} with method {method} succeeds when bearer token is {token}",
			action: async ({ url, method, token }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${String(token)}`,
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: "1",
						method: String(method),
						params: {},
						seqPath: [0, 1, 1, 1],
					}),
				});
				if (!res.ok) return actionNotOK(`HTTP ${res.status}`);
				const data = await res.json();
				if (data.error) return actionNotOK(data.error);
				if (data.protected !== true) {
					return actionNotOK(`Expected protected=true, got ${JSON.stringify(data)}`);
				}
				return OK;
			},
		},
		rpcCallDeniedWithBearerToken: {
			gwta: "rpc call to {url} with method {method} is denied when bearer token is {token}",
			action: async ({ url, method, token }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${String(token)}`,
					},
					body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: String(method), params: {}, seqPath: [0, 1, 1, 1] }),
				});
				const data = await res.json();
				if (res.status !== 422) return actionNotOK(`Expected HTTP 422, got ${res.status}`);
				if (typeof data.error !== "string" || !data.error.includes("capability PingStepper:protected required")) {
					return actionNotOK(`Expected capability error, got ${JSON.stringify(data)}`);
				}
				return OK;
			},
		},
		rpcCallDeniedForCapability: {
			gwta: "rpc call to {url} with method {method} is denied for capability {capability} when bearer token is {token}",
			action: async ({ url, method, capability, token }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${String(token)}`,
					},
					body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: String(method), params: {}, seqPath: [0, 1, 1, 1] }),
				});
				const data = await res.json();
				if (res.status !== 422) return actionNotOK(`Expected HTTP 422, got ${res.status}`);
				if (typeof data.error !== "string" || !data.error.includes(`capability ${String(capability)} required`)) {
					return actionNotOK(`Expected capability error, got ${JSON.stringify(data)}`);
				}
				return OK;
			},
		},
		rpcOldFormatIgnored: {
			gwta: "rpc old format to {url} is not dispatched",
			action: async ({ url }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ type: "rpc", id: "1", method: "step.list", params: {} }),
				});
				const data = await res.json();
				// Old format is not parsed as a valid JSON-RPC 2.0 request, so no handler processes it.
				// Transport returns { ok: true } as default (no handler matched).
				if (Array.isArray(data)) return actionNotOK("Got step.list response — old format should not be dispatched");
				return OK;
			},
		},
	};
}

function makeOptions(port: number) {
	return {
		...DEF_PROTO_OPTIONS,
		moduleOptions: { [getStepperOptionName(WebServerStepper, "PORT")]: String(port) },
	};
}

const steppers = [WebServerStepper, PingStepper, RpcVerifyStepper];

describe("RPC dispatch via WebServerStepper", () => {
	it("step.list includes PingStepper-ping", async () => {
		const port = 8234;
		const feature = {
			path: "/features/test.feature",
			content: `
enable rpc
webserver is listening for "rpc-step-list"
rpc step list at "http://localhost:${port}/rpc/step.list" includes "PingStepper-ping"
`,
		};
		const result = await passWithDefaults([feature], steppers, makeOptions(port));
		expect(result.ok).toBe(true);
	});

	it("executes a step via RPC", async () => {
		const port = 8235;
		const feature = {
			path: "/features/test.feature",
			content: `
enable rpc
webserver is listening for "rpc-step-exec"
rpc call to "http://localhost:${port}/rpc/PingStepper-ping" with method "PingStepper-ping" succeeds
`,
		};
		const result = await passWithDefaults([feature], steppers, makeOptions(port));
		expect(result.ok).toBe(true);
	});

	it("rejects old-format RPC envelope", async () => {
		const port = 8236;
		const feature = {
			path: "/features/test.feature",
			content: `
enable rpc
webserver is listening for "rpc-old-format"
rpc old format to "http://localhost:${port}/rpc/step.list" is not dispatched
`,
		};
		const result = await passWithDefaults([feature], steppers, makeOptions(port));
		expect(result.ok).toBe(true);
	});

	it("step.list returns { steps, domains } shape", async () => {
		const port = 8237;
		// Intercept the raw step.list response to verify shape
		let capturedStepList: unknown;
		class StepListCaptureStepper extends AStepper {
			steps = {
				captureStepList: {
					gwta: "capture step list at {url}",
					action: async ({ url }: { url: string }) => {
						const res = await fetch(String(url), {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "step.list", params: {} }),
						});
						capturedStepList = await res.json();
						return OK;
					},
				},
			};
		}

		const captureFeature = {
			path: "/features/shape-test.feature",
			content: `
enable rpc
webserver is listening for "rpc-shape-test"
capture step list at "http://localhost:${port + 10}/rpc/step.list"
`,
		};
		const shapeSteppers = [WebServerStepper, PingStepper, StepListCaptureStepper];
		await passWithDefaults([captureFeature], shapeSteppers, makeOptions(port + 10));

		expect(capturedStepList).toHaveProperty("steps");
		expect(capturedStepList).toHaveProperty("domains");
		expect(Array.isArray((capturedStepList as { steps: unknown }).steps)).toBe(true);
	});

	it("session.beginAction allocates a unique seqPath root per call", async () => {
		const port = 8240;
		let first: number[] | undefined;
		let second: number[] | undefined;

		class BeginActionStepper extends AStepper {
			steps = {
				callBeginActionTwice: {
					gwta: "begin action twice at {url}",
					action: async ({ url }: { url: string }) => {
						const u = String(url);
						const body = JSON.stringify({ jsonrpc: "2.0", id: "1", method: "session.beginAction", params: {} });
						const headers = { "Content-Type": "application/json" };
						const r1 = (await (await fetch(u, { method: "POST", headers, body })).json()) as Record<string, unknown>;
						const r2 = (await (await fetch(u, { method: "POST", headers, body })).json()) as Record<string, unknown>;
						first = Array.isArray(r1.seqPath) ? (r1.seqPath as number[]) : undefined;
						second = Array.isArray(r2.seqPath) ? (r2.seqPath as number[]) : undefined;
						return OK;
					},
				},
			};
		}

		const feature = {
			path: "/features/begin-action.feature",
			content: `
enable rpc
webserver is listening for "rpc-begin-action"
begin action twice at "http://localhost:${port}/rpc/session.beginAction"
`,
		};
		const r = await passWithDefaults([feature], [WebServerStepper, PingStepper, BeginActionStepper], makeOptions(port));
		expect(r.ok).toBe(true);
		if (!first || !second) throw new Error("begin action did not return seqPaths");
		expect(first.length).toBeGreaterThan(0);
		expect(first.join(".")).not.toBe(second.join("."));
	});

	it("refuses state-changing RPC calls that omit seqPath", async () => {
		const port = 8238;
		let errorFromMissingSeqPath: string | undefined;

		class MissingSeqPathStepper extends AStepper {
			steps = {
				callWithoutSeqPath: {
					gwta: "rpc call to {url} without seqPath is refused",
					action: async ({ url }: { url: string }) => {
						const res = await fetch(String(url), {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "PingStepper-ping", params: {} }),
						});
						const data = (await res.json()) as Record<string, unknown>;
						errorFromMissingSeqPath = typeof data.error === "string" ? data.error : undefined;
						return OK;
					},
				},
			};
		}

		const feature = {
			path: "/features/missing-seqpath.feature",
			content: `
enable rpc
webserver is listening for "rpc-missing-seqpath"
rpc call to "http://localhost:${port}/rpc/PingStepper-ping" without seqPath is refused
`,
		};
		const r = await passWithDefaults([feature], [WebServerStepper, PingStepper, MissingSeqPathStepper], makeOptions(port));
		expect(r.ok).toBe(true);
		// State-changing RPC without seqPath must be refused with a clear error.
		expect(errorFromMissingSeqPath).toMatch(/missing seqPath/);
	});

	it("denies protected RPC steps without capability and allows them with capability", async () => {
		const port = 8239;
		const feature = {
			path: "/features/protected-rpc.feature",
			content: `
enable rpc
webserver is listening for "rpc-protected-step"
rpc call to "http://localhost:${port}/rpc/PingStepper-protectedPing" with method "PingStepper-protectedPing" is denied without capability
rpc call to "http://localhost:${port}/rpc/PingStepper-protectedPing" with method "PingStepper-protectedPing" succeeds when bearer token is "rpc-protected-token"
`,
		};
		const result = await passWithDefaults([feature], steppers, {
			...DEF_PROTO_OPTIONS,
			moduleOptions: {
				[getStepperOptionName(WebServerStepper, "PORT")]: String(port),
				[getStepperOptionName(WebServerStepper, "RPC_ACCESS_TOKEN")]: "rpc-protected-token",
				[getStepperOptionName(WebServerStepper, "RPC_ACCESS_CAPABILITY")]: "PingStepper:protected",
			},
		});
		expect(result.ok).toBe(true);
	});

	it("authorizes protected RPC steps through zcap-like bearer grants and revokes them cleanly", async () => {
		const port = 8240;
		const feature = {
			path: "/features/zcap-like-protected-rpc.feature",
			content: `
enable rpc
webserver is listening for "rpc-zcap-like-step"
issue zcap-like bearer grant for token "zcap-like-token" with capability "PingStepper:protected"
rpc call to "http://localhost:${port}/rpc/PingStepper-protectedPing" with method "PingStepper-protectedPing" succeeds when bearer token is "zcap-like-token"
revoke zcap-like bearer grant for token "zcap-like-token"
rpc call to "http://localhost:${port}/rpc/PingStepper-protectedPing" with method "PingStepper-protectedPing" is denied when bearer token is "zcap-like-token"
`,
		};
		const result = await passWithDefaults([feature], [ZcapLikeStepper, ...steppers], makeOptions(port));
		expect(result.ok).toBe(true);
	});

	it("keeps RPC bearer capability mappings least-privilege", async () => {
		const port = 8241;
		const feature = {
			path: "/features/rpc-least-privilege.feature",
			content: `
enable rpc
webserver is listening for "rpc-least-privilege"
rpc call to "http://localhost:${port}/rpc/PingStepper-protectedPing" with method "PingStepper-protectedPing" succeeds when bearer token is "rpc-protected-token"
rpc call to "http://localhost:${port}/rpc/PingStepper-adminPing" with method "PingStepper-adminPing" is denied for capability "PingStepper:admin" when bearer token is "rpc-protected-token"
`,
		};
		const result = await passWithDefaults([feature], steppers, {
			...DEF_PROTO_OPTIONS,
			moduleOptions: {
				[getStepperOptionName(WebServerStepper, "PORT")]: String(port),
				[getStepperOptionName(WebServerStepper, "RPC_ACCESS_TOKEN")]: "rpc-protected-token",
				[getStepperOptionName(WebServerStepper, "RPC_ACCESS_CAPABILITY")]: "PingStepper:protected",
			},
		});
		expect(result.ok).toBe(true);
	});
});
