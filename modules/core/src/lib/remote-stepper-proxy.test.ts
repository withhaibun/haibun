import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RemoteStepperProxy } from "./remote-stepper-proxy.js";
import { openRunRegistry, StepRegistry } from "./step-registry.js";
import Haibun from "../steps/haibun.js";
import { AStepper } from "./astepper.js";
import { actionOKWithProducts, errorDetail } from "./util/index.js";
import { getDefaultWorld } from "./test/lib.js";
import { FakeInvoker } from "./test/fake-authority.js";
import { AUTHORITY_KEY, SessionAuthority } from "./session-authority.js";
import { RUN_AUTHORITY, runAuthorizedWith } from "./capability-context.js";
import type { TWorld } from "./world.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Server } from "http";

class EchoStepper extends AStepper {
	description = "Steps that echo a message and answer a protected ping, served by a remote host.";
	steps = {
		echo: {
			gwta: "echo {message: string}",
			action: async ({ message }: { message: string }) => actionOKWithProducts({ echoed: message }),
		},
		protectedPing: {
			gwta: "protected ping",
			capability: "EchoStepper:admin",
			action: async () => actionOKWithProducts({ pong: true }),
		},
		echoLabel: {
			gwta: "echo the label of {query: json}",
			action: async ({ query }: { query: { label?: string } }) => actionOKWithProducts({ label: query.label ?? null }),
		},
	};
}

describe("RemoteStepperProxy", () => {
	let server: Server;
	let port: number;
	let world: TWorld;
	/** What each call to the host presented, by the method it called. */
	const presented = new Map<string, string | undefined>();

	beforeAll(async () => {
		// Start a minimal RPC server with EchoStepper
		world = getDefaultWorld() as TWorld;
		// Every step the host serves requires an action, so the proxy signs each call to one as the holder it presents.
		const authority = new SessionAuthority();
		authority.registerInvoker(new FakeInvoker("proxy"));
		(world.runtime.keys ??= {})[AUTHORITY_KEY] = authority;
		// The host serves its declarations through the show steps step, dispatched like any other.
		const hosted = [new EchoStepper(), new Haibun()];
		for (const stepper of hosted) await stepper.setWorld(world, hosted);
		const localRegistry = openRunRegistry(world, hosted);

		const app = new Hono();
		app.post("/rpc/:_method", async (c) => {
			const data = (await c.req.json()) as { method: string; params?: Record<string, unknown> };
			presented.set(data.method, c.req.header("capability-invocation"));
			if (data.method === "action.begin") {
				return c.json({ seqPath: [7, -1, 1], hostId: 7 });
			}
			const tool = localRegistry.get(data.method);
			if (!tool) return c.json({ error: `not found: ${data.method}` }, 422);
			try {
				const { buildFeatureStepForTransport } = await import("./step-registry.js");
				const featureStep = buildFeatureStepForTransport(tool, data.params ?? {}, [0, 1]);
				// The host grants the proxy every step it serves, so what the proxy is shown and may call is all of it.
				const result = await runAuthorizedWith(RUN_AUTHORITY, () => tool.handler(featureStep, world));
				if (result.ok) return c.json(result.products ?? {});
				return c.json({ error: result.errorMessage }, 422);
			} catch (err) {
				return c.json({ error: errorDetail(err) }, 422);
			}
		});

		port = 18900 + Math.floor(Math.random() * 100);
		server = serve({ fetch: app.fetch, port });
	});

	afterAll(() => {
		server?.close();
	});

	it("fetches step descriptors from remote host", async () => {
		const proxy = new RemoteStepperProxy(`http://localhost:${port}`);
		await proxy.setWorld(world, []);
		expect(proxy.descriptors.length).toBeGreaterThan(0);
		expect(proxy.descriptors.map((d) => d.method)).toContain("EchoStepper-echo");
	});

	it("injects proxy tools into registry under hostId-prefixed keys", async () => {
		const proxy = new RemoteStepperProxy(`http://localhost:${port}`);
		await proxy.setWorld(world, []);
		expect(proxy.remoteHostId).toBe(7);

		const registry = new StepRegistry([], world);
		proxy.injectInto(registry);

		// Prefixed key reflects the remote's hostId so it can't collide with
		// local tools or other hosts' tools of the same method name.
		const tool = registry.get("host7_EchoStepper-echo");
		if (!tool) throw new Error("Expected prefixed tool to be registered");
		// Bare name (local form) must NOT be registered, prefixing is total.
		expect(registry.get("EchoStepper-echo")).toBeUndefined();
		expect(tool.descriptor, "the host's description of the step, under the host's name for it and with the host it runs at").toMatchObject({
			method: "host7_EchoStepper-echo",
			stepperName: "EchoStepper",
			stepperDescription: "Steps that echo a message and answer a protected ping, served by a remote host.",
			pattern: "echo {message: string}",
			remoteHost: `localhost:${port}`,
			paramDomains: { message: "string" },
			read: false,
			fallback: false,
		});
		expect(tool.descriptor.inputSchema.required).toEqual(["message"]);

		const { buildFeatureStepForTransport } = await import("./step-registry.js");
		const featureStep = buildFeatureStepForTransport(tool, { message: "hello" }, [0, 1]);
		const result = await tool.handler(featureStep, world);
		expect(result.ok).toBe(true);
		expect(result.products).toMatchObject({ echoed: "hello" });
	});

	it("carries a call's object argument to the host as the object, not as its text", async () => {
		const proxy = new RemoteStepperProxy(`http://localhost:${port}`);
		await proxy.setWorld(world, []);
		const registry = new StepRegistry([], world);
		proxy.injectInto(registry);
		const tool = registry.get("host7_EchoStepper-echoLabel");
		if (!tool) throw new Error("Expected prefixed tool to be registered");
		const { buildFeatureStepForTransport } = await import("./step-registry.js");
		const result = await tool.handler(buildFeatureStepForTransport(tool, { query: { label: "Comment" } }, [0, 1]), world);
		expect(result.products).toMatchObject({ label: "Comment" });
	});

	it("preserves capability metadata from remote", async () => {
		const proxy = new RemoteStepperProxy(`http://localhost:${port}`);
		await proxy.setWorld(world, []);

		const registry = new StepRegistry([], world);
		proxy.injectInto(registry);

		const tool = registry.get("host7_EchoStepper-protectedPing");
		if (!tool) throw new Error("Expected prefixed tool to be registered");
		expect(tool.descriptor.capability).toBe("EchoStepper:admin");
	});

	it("signs a call to a step for the action it requires, its own name where it declares none, and reading what the host offers as a public read", async () => {
		const proxy = new RemoteStepperProxy(`http://localhost:${port}`);
		await proxy.setWorld(world, []);
		const registry = new StepRegistry([], world);
		proxy.injectInto(registry);
		const { buildFeatureStepForTransport } = await import("./step-registry.js");
		for (const [method, input] of [
			["host7_EchoStepper-protectedPing", {}],
			["host7_EchoStepper-echo", { message: "hi" }],
		] as const) {
			const tool = registry.get(method);
			if (!tool) throw new Error(`Expected ${method} to be registered`);
			expect((await tool.handler(buildFeatureStepForTransport(tool, input, [0, 1]), world)).ok).toBe(true);
		}
		expect(presented.get("EchoStepper-protectedPing")).toBe('fake action="EchoStepper:admin"');
		expect(presented.get("EchoStepper-echo")).toBe('fake action="EchoStepper:echo"');
		expect(presented.get("Haibun-showSteps"), "the host shows the steps the proxy holds there").toBe('fake action="Read:public"');
		expect(presented.get("action.begin"), "and the handshake requires nothing").toBeUndefined();
	});
});
