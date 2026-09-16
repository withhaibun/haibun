import { describe, it, expect } from "vitest";
import { passWithDefaults, DEF_PROTO_OPTIONS } from "@haibun/core/lib/test/lib.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { OK, type TStepArgs } from "@haibun/core/schema/protocol.js";
import { actionNotOK, actionOKWithProducts, getStepperOptionName } from "@haibun/core/lib/util/index.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import WebServerStepper from "./web-server-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { EVERY_DEFINITION, SHOW_STEPS_METHOD, StepDefinitionsSchema, type TStepDefinition } from "@haibun/core/lib/step-discovery.js";
import { streamContext, type TStreamChunk } from "@haibun/core/lib/step-stream-context.js";

class PingStepper extends AStepper {
	description = "Steps that answer a ping, one of them protected and one gated by an admin capability.";
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

/** The steps a caller is shown, read as a page reads them. */
async function shownSteps(url: string, headers: Record<string, string>): Promise<TStepDefinition[]> {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: SHOW_STEPS_METHOD, params: EVERY_DEFINITION, asks: "read" }),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
	const { _seqPath, ...declared } = (await res.json()) as Record<string, unknown>;
	return StepDefinitionsSchema.parse(declared).steps;
}

class RpcVerifyStepper extends AStepper {
	description = "Steps that call a run over RPC and check what it answers.";
	steps = {
		shownStepsInclude: {
			gwta: "steps shown to a caller with no token at {url} include {included}",
			action: async ({ url, included }: TStepArgs) => {
				const methods = (await shownSteps(String(url), {})).map((step) => step.method);
				return methods.includes(String(included)) ? OK : actionNotOK(`"${included}" not in [${methods.join(", ")}]`);
			},
		},
		shownStepRequires: {
			gwta: "caller with bearer token {token} is shown {method} at {url} requiring {capability}",
			action: async ({ url, token, method, capability }: TStepArgs) => {
				const step = (await shownSteps(String(url), { Authorization: `Bearer ${String(token)}` })).find((shown) => shown.method === String(method));
				return step?.capability === String(capability) ? OK : actionNotOK(`${method} is shown as ${JSON.stringify(step)}`);
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
		rpcReadOfStepRefused: {
			gwta: "rpc read at {url} of {method} is refused",
			action: async ({ url, method }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: String(method), params: {}, seqPath: [0, 1, 1, 1], asks: "read" }),
				});
				const data = (await res.json()) as { error?: string };
				if (res.status !== 422) return actionNotOK(`answered a read of a step that declares none: HTTP ${res.status}`);
				return typeof data.error === "string" && data.error.includes("does not declare itself one") ? OK : actionNotOK(`refused without saying why: ${JSON.stringify(data)}`);
			},
		},
		rpcReadOfStepAnswered: {
			gwta: "rpc read at {url} of {method} is answered",
			action: async ({ url, method }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: String(method), params: {}, seqPath: [0, 1, 1, 1], asks: "read" }),
				});
				const data = (await res.json()) as { error?: string };
				if (!res.ok || data.error) return actionNotOK(`refused a read of a step that declares itself one: ${res.status} ${JSON.stringify(data)}`);
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
					body: JSON.stringify({ type: "rpc", id: "1", method: SHOW_STEPS_METHOD, params: EVERY_DEFINITION }),
				});
				const data = await res.json();
				// Old format is not parsed as a valid JSON-RPC 2.0 request, so no handler processes it.
				// Transport returns { ok: true } as default (no handler matched).
				if ("steps" in data) return actionNotOK("the old format was dispatched");
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

/** What the run narrated about the calls it served, so a case can state which of them it narrates. */
const narrated: string[] = [];

class ReadStepper extends AStepper {
	description = "A step that declares itself a read, and a step that checks which RPC calls the run narrated.";
	override async setWorld(world: Parameters<AStepper["setWorld"]>[0], steppers: Parameters<AStepper["setWorld"]>[1]) {
		await super.setWorld(world, steppers);
		narrated.length = 0;
		world.eventLogger.subscribe(
			(event) => {
				const said = (event as { message?: unknown }).message;
				if (typeof said === "string" && said.startsWith("RPC: ")) narrated.push(said);
			},
			{ kinds: ["log"] },
		);
	}

	steps = {
		asked: {
			gwta: "run is asked what it holds",
			read: true,
			action: () => Promise.resolve(actionOKWithProducts({ holds: 1 })),
		},
		narratedCalls: {
			gwta: "run narrated the call that acted on it and not the call that read it",
			action: () => {
				const named = (method: string) => narrated.filter((line) => line.includes(method)).length;
				if (named("ReadStepper-asked") > 0) return Promise.resolve(actionNotOK(`serving a read was narrated: ${JSON.stringify(narrated)}`));
				return Promise.resolve(named("PingStepper-ping") > 0 ? OK : actionNotOK(`serving an act was not narrated: ${JSON.stringify(narrated)}`));
			},
		},
	};
}

const steppers = [WebServerStepper, PingStepper, RpcVerifyStepper, ReadStepper, Haibun];

describe("RPC dispatch via WebServerStepper", () => {
	it("does not narrate serving a read, since a page reading the run would read again for its own reading", async () => {
		const port = 8244;
		const feature = {
			path: "/features/test.feature",
			content: `
enable rpc
webserver is listening for "rpc-read-narration"
rpc call to "http://localhost:${port}/rpc/ReadStepper-asked" with method "ReadStepper-asked" succeeds
rpc call to "http://localhost:${port}/rpc/PingStepper-ping" with method "PingStepper-ping" succeeds
run narrated the call that acted on it and not the call that read it
`,
		};
		const result = await passWithDefaults([feature], steppers, makeOptions(port));
		expect(result.ok).toBe(true);
	});

	it("answers a read of a step that declares itself one, and refuses to answer a read of a step that does not", async () => {
		// A read is answered and leaves no record of the reading, so what may be read that way is what the step itself
		// declares. Asked to read a step that declares nothing, the run refuses rather than answering and recording the
		// reading as something it did, which is a run that writes about being read for as long as a page follows it.
		const port = 8246;
		const feature = {
			path: "/features/test.feature",
			content: `
enable rpc
webserver is listening for "rpc-asks-read"
rpc read at "http://localhost:${port}/rpc/ReadStepper-asked" of "ReadStepper-asked" is answered
rpc read at "http://localhost:${port}/rpc/PingStepper-ping" of "PingStepper-ping" is refused
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
rpc old format to "http://localhost:${port}/rpc/${SHOW_STEPS_METHOD}" is not dispatched
`,
		};
		const result = await passWithDefaults([feature], steppers, makeOptions(port));
		expect(result.ok).toBe(true);
	});

	it("shows a caller a step it may not call, with the capability the step requires", async () => {
		const port = 8237;
		const feature = {
			path: "/features/shown-steps.feature",
			content: `
enable rpc
webserver is listening for "rpc-shown-steps"
caller with bearer token "rpc-protected-token" is shown "PingStepper-adminPing" at "http://localhost:${port}/rpc/${SHOW_STEPS_METHOD}" requiring "PingStepper:admin"
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

	it("shows and dispatches a step injected into the run's registry after rpc is enabled, as every other caller of the run does", async () => {
		const port = 8238;
		class Injects extends AStepper {
			description = "A step that copies a step into the run's registry under another name, as a transport injects one.";
			steps = {
				injectAStep: {
					gwta: "inject a step into the run's registry",
					action: () => {
						const registry = this.getWorld().runtime.stepRegistry;
						const ping = registry?.get("PingStepper-ping");
						if (!registry || !ping) return Promise.resolve(actionNotOK("the run holds no ping to copy"));
						registry.inject([{ ...ping, descriptor: { ...ping.descriptor, method: "Injected-ping", stepperName: "Injected", stepName: "ping" } }]);
						return Promise.resolve(OK);
					},
				},
			};
		}
		const feature = {
			path: "/features/injected.feature",
			content: `
enable rpc
webserver is listening for "rpc-injected"
inject a step into the run's registry
steps shown to a caller with no token at "http://localhost:${port}/rpc/${SHOW_STEPS_METHOD}" include "Injected-ping"
rpc call to "http://localhost:${port}/rpc/Injected-ping" with method "Injected-ping" succeeds
`,
		};
		const result = await passWithDefaults([feature], [...steppers, Injects], makeOptions(port));
		expect(result.ok).toBe(true);
	});

	it("action.begin allocates a unique seqPath root per call", async () => {
		const port = 8240;
		let first: number[] | undefined;
		let second: number[] | undefined;

		class BeginActionStepper extends AStepper {
			steps = {
				callBeginActionTwice: {
					gwta: "begin action twice at {url}",
					action: async ({ url }: { url: string }) => {
						const u = String(url);
						const body = JSON.stringify({ jsonrpc: "2.0", id: "1", method: "action.begin", params: {} });
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
begin action twice at "http://localhost:${port}/rpc/action.begin"
`,
		};
		const r = await passWithDefaults([feature], [WebServerStepper, PingStepper, BeginActionStepper], makeOptions(port));
		expect(r.ok).toBe(true);
		if (!first || !second) throw new Error("begin action did not return seqPaths");
		expect(first.length).toBeGreaterThan(0);
		expect(first.join(".")).not.toBe(second.join("."));
	});

	it("synthesises a seqPath when the caller omits one", async () => {
		const port = 8238;
		let rpcResponse: Record<string, unknown> | undefined;

		class MissingSeqPathStepper extends AStepper {
			steps = {
				callWithoutSeqPath: {
					gwta: "rpc call to {url} without seqPath succeeds",
					action: async ({ url }: { url: string }) => {
						const res = await fetch(String(url), {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "PingStepper-ping", params: {} }),
						});
						rpcResponse = (await res.json()) as Record<string, unknown>;
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
rpc call to "http://localhost:${port}/rpc/PingStepper-ping" without seqPath succeeds
`,
		};
		const r = await passWithDefaults([feature], [WebServerStepper, PingStepper, MissingSeqPathStepper], makeOptions(port));
		expect(r.ok).toBe(true);
		// External callers without a feature-step context get a server-synthesised seqPath; the call succeeds.
		expect(rpcResponse?.error).toBeUndefined();
		expect(rpcResponse?.pong).toBe(true);
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

	it("authorizes protected RPC steps through session grants and revokes them cleanly", async () => {
		const port = 8240;
		const feature = {
			path: "/features/protected-rpc.feature",
			content: `
enable rpc
webserver is listening for "rpc-session-step"
issue session grant for token "session-token" with action "PingStepper:protected"
rpc call to "http://localhost:${port}/rpc/PingStepper-protectedPing" with method "PingStepper-protectedPing" succeeds when bearer token is "session-token"
revoke session grant for token "session-token"
rpc call to "http://localhost:${port}/rpc/PingStepper-protectedPing" with method "PingStepper-protectedPing" is denied when bearer token is "session-token"
`,
		};
		const result = await passWithDefaults([feature], [AuthorityStepper, ...steppers], makeOptions(port));
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

	it("stream:true routes through dispatchStep, chunks flow via streamContext, errors land on seqPath", async () => {
		const port = 8242;
		const collectedChunks: TStreamChunk[] = [];

		class StreamingStepper extends AStepper {
			steps = {
				stream3: {
					gwta: "emit three streaming chunks",
					action: () => {
						const sctx = streamContext.getStore();
						sctx?.emit({ status: "starting" });
						sctx?.emit({ text: "alpha" });
						sctx?.emit({ text: "beta" });
						return actionOKWithProducts({ text: "alphabeta" });
					},
				},
				failStream: {
					gwta: "stream that refuses",
					action: () => actionNotOK("stream refused"),
				},
			};
		}

		class StreamingRpcVerifyStepper extends AStepper {
			steps = {
				streamChunksArrive: {
					gwta: "stream rpc call to {url} method {method} emits chunks",
					action: async ({ url, method }: TStepArgs) => {
						const res = await fetch(String(url), {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: String(method), params: {}, seqPath: [0, 1, 1, 1], stream: true }),
						});
						if (!res.ok) return actionNotOK(`HTTP ${res.status}`);
						if (!res.body) return actionNotOK("no response body");
						const reader = res.body.getReader();
						const decoder = new TextDecoder();
						let buf = "";
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							buf += decoder.decode(value, { stream: true });
							const lines = buf.split("\n");
							buf = lines.pop() ?? "";
							for (const line of lines) {
								if (!line.trim()) continue;
								collectedChunks.push(JSON.parse(line) as TStreamChunk);
							}
						}
						return OK;
					},
				},
			};
		}

		const feature = {
			path: "/features/stream-rpc.feature",
			content: `
enable rpc
webserver is listening for "stream-rpc"
stream rpc call to "http://localhost:${port}/rpc/StreamingStepper-stream3" method "StreamingStepper-stream3" emits chunks
`,
		};
		const result = await passWithDefaults([feature], [WebServerStepper, StreamingStepper, StreamingRpcVerifyStepper], makeOptions(port));
		expect(result.ok).toBe(true);
		// All three streamed chunks arrived via streamContext.emit; no terminal "products" record because dispatch was OK.
		expect(collectedChunks).toEqual([{ status: "starting" }, { text: "alpha" }, { text: "beta" }]);
	});

	it("stream:true refusal emits a single terminating {error} record naming the step once, whether the step refused or threw", async () => {
		const port = 8243;
		const collectedChunks: Record<string, unknown>[] = [];

		class StreamingStepper extends AStepper {
			steps = {
				refuse: {
					gwta: "refuse the stream",
					action: () => actionNotOK("nope"),
				},
				fail: {
					gwta: "fail the stream",
					action: () => {
						throw new Error("broke");
					},
				},
			};
		}

		class StreamingErrorVerifyStepper extends AStepper {
			steps = {
				streamErrorArrives: {
					gwta: "stream rpc call to {url} method {method} emits an error",
					action: async ({ url, method }: TStepArgs) => {
						const res = await fetch(String(url), {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: String(method), params: {}, seqPath: [0, 1, 1, 1], stream: true }),
						});
						if (!res.body) return actionNotOK("no response body");
						const reader = res.body.getReader();
						const decoder = new TextDecoder();
						let buf = "";
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							buf += decoder.decode(value, { stream: true });
							const lines = buf.split("\n");
							buf = lines.pop() ?? "";
							for (const line of lines) {
								if (!line.trim()) continue;
								collectedChunks.push(JSON.parse(line) as Record<string, unknown>);
							}
						}
						return OK;
					},
				},
			};
		}

		const feature = {
			path: "/features/stream-rpc-error.feature",
			content: `
enable rpc
webserver is listening for "stream-rpc-error"
stream rpc call to "http://localhost:${port}/rpc/StreamingStepper-refuse" method "StreamingStepper-refuse" emits an error
stream rpc call to "http://localhost:${port}/rpc/StreamingStepper-fail" method "StreamingStepper-fail" emits an error
`,
		};
		const result = await passWithDefaults([feature], [WebServerStepper, StreamingStepper, StreamingErrorVerifyStepper], makeOptions(port));
		expect(result.ok).toBe(true);
		expect(collectedChunks.map((chunk) => chunk.error)).toEqual(["StreamingStepper-refuse: nope", "StreamingStepper-fail: broke"]);
	});
});
