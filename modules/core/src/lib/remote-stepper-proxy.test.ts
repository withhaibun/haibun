import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RemoteStepperProxy } from "./remote-stepper-proxy.js";
import { StepRegistry } from "./step-dispatch.js";
import { AStepper } from "./astepper.js";
import { actionOKWithProducts, errorDetail } from "./util/index.js";
import { getDefaultWorld } from "./test/lib.js";
import type { TWorld } from "./world.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Server } from "http";

class EchoStepper extends AStepper {
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
	};
}

describe("RemoteStepperProxy", () => {
	let server: Server;
	let port: number;
	let world: TWorld;

	beforeAll(async () => {
		// Start a minimal RPC server with EchoStepper
		world = getDefaultWorld() as TWorld;
		const echoStepper = new EchoStepper();
		await echoStepper.setWorld(world, [echoStepper]);
		const localRegistry = new StepRegistry([echoStepper], world);

		const app = new Hono();
		app.post("/rpc/:_method", async (c) => {
			const data = (await c.req.json()) as { method: string; params?: Record<string, unknown> };
			if (data.method === "session.beginAction") {
				return c.json({ seqPath: [7, -1, 1], hostId: 7 });
			}
			if (data.method === "step.list") {
				const steps = localRegistry.list().map((t) => ({
					stepperName: t.stepperName,
					stepName: t.stepName,
					method: t.name,
					pattern: t.description,
					params: {},
					capability: t.capability,
					inputSchema: t.inputSchema,
				}));
				return c.json({ steps });
			}
			const tool = localRegistry.get(data.method);
			if (!tool) return c.json({ error: `not found: ${data.method}` }, 422);
			try {
				const { buildSyntheticFeatureStep } = await import("./step-dispatch.js");
				const featureStep = buildSyntheticFeatureStep(tool, data.params ?? {}, [0, 1]);
				const result = await tool.handler(featureStep, world);
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
		const proxy = new RemoteStepperProxy(`http://localhost:${port}`, "test-token");
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
		const tool = registry.get("7:EchoStepper-echo");
		if (!tool) throw new Error("Expected prefixed tool to be registered");
		// Bare name (local form) must NOT be registered — prefixing is total.
		expect(registry.get("EchoStepper-echo")).toBeUndefined();

		const { buildSyntheticFeatureStep } = await import("./step-dispatch.js");
		const featureStep = buildSyntheticFeatureStep(tool, { message: "hello" }, [0, 1]);
		const result = await tool.handler(featureStep, world);
		expect(result.ok).toBe(true);
		expect(result.products).toMatchObject({ echoed: "hello" });
	});

	it("preserves capability metadata from remote", async () => {
		const proxy = new RemoteStepperProxy(`http://localhost:${port}`);
		await proxy.setWorld(world, []);

		const registry = new StepRegistry([], world);
		proxy.injectInto(registry);

		const tool = registry.get("7:EchoStepper-protectedPing");
		if (!tool) throw new Error("Expected prefixed tool to be registered");
		expect(tool.capability).toBe("EchoStepper:admin");
	});
});
