import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { RemoteStepperProxy } from "./remote-proxy-stepper.js";
import { buildFeatureStepForTransport } from "../steps/pipelines/call-step.js";
import { hostScopedMethodName, stepMethodName } from "../steps/domains/step-method.js";
import { openRunRegistry, StepRegistry } from "../steps/pipelines/step-registry.js";
import Haibun from "../../steps/haibun-stepper.js";
import { AStepper } from "../steps/domains/stepper.js";
import { actionNotOK, actionOKWithProducts, errorDetail } from "../domains/util.js";
import { getDefaultWorld } from "../test/lib.js";
import { TEST_DOMAIN, testDomainDefinitions } from "../test/test-domains.js";
import { addStepperConcerns } from "../actuality/pipelines/executor.js";
import { FakeInvoker } from "../test/fake-authority.js";
import { AUTHORITY_KEY, SessionAuthority } from "../session-authority.js";
import { RUN_AUTHORITY, runAuthorizedWith } from "../domains/capability-context.js";
import type { TWorld } from "../actuality/domains/world.js";
import { SITE_DID_PREFIX } from "../domains/host-id.js";
import { DOMAIN_STRING, asDomainKey, DOMAIN_TEXT } from "../domains/domains.js";
import { OK, Origin, type TStepValue } from "../domains/protocol.js";
import { ACTION_BEGIN, ANSWERED_WITHOUT_PRODUCTS, callFailed } from "./ports.js";
import { hostHandshake } from "../test/rpc-answer.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

const ECHOED_LABEL = "test-echoed-label";
/** Two domains whose union a parameter takes. */
const PICKS = ["test-pick-by-name", "test-pick-by-id"];
const DOMAIN_PICK = asDomainKey(PICKS);

/** The id the host states for itself. The proxy prefixes the host's steps with it. */
const HOST = 7;
/** The reason the host's refusing step returns. */
const REFUSED = "the host refused";

class EchoStepper extends AStepper {
	description = "Steps on a remote host that echo a message and respond to a protected ping.";
	cycles = {
		getConcerns: () => ({
			domains: [
				...testDomainDefinitions,
				{ selectors: [ECHOED_LABEL], schema: z.object({ label: z.string().nullable() }), description: "A label a step echoed" },
				...PICKS.map((pick) => ({ selectors: [pick], schema: z.string(), description: `A value of ${pick}` })),
				{ selectors: PICKS, schema: z.string(), description: "A value of either domain" },
			],
		}),
	};
	steps = {
		echo: {
			gwta: `echo {message: ${DOMAIN_TEXT}}`,
			productsDomain: TEST_DOMAIN.echoed,
			action: async ({ message }: { message: string }) => actionOKWithProducts({ echoed: message }),
		},
		protectedPing: { gwta: "protected ping", capability: "EchoStepper:admin", productsDomain: TEST_DOMAIN.pong, action: async () => actionOKWithProducts({ pong: true }) },
		acts: { gwta: "act", action: async () => OK },
		refuses: { gwta: "refuse", action: async () => actionNotOK(REFUSED) },
		echoPick: {
			gwta: `echo the pick {pick: ${DOMAIN_PICK}}`,
			productsDomain: TEST_DOMAIN.echoed,
			action: async ({ pick }: { pick: TStepValue }) => actionOKWithProducts({ echoed: String(pick.value) }),
		},
		echoLabel: {
			gwta: "echo the label of {query: json}",
			productsDomain: ECHOED_LABEL,
			action: async ({ query }: { query: { label?: string } }) => actionOKWithProducts({ label: query.label ?? null }),
		},
	};
}

describe("RemoteStepperProxy", () => {
	let server: ReturnType<typeof serve>;
	let port: number;
	let world: TWorld;
	/** Returns the proxy's tool for an echo stepper step. The proxy registers it under the host-scoped method name. */
	const hostTool = async (step: string) => {
		const proxy = new RemoteStepperProxy(`http://localhost:${port}`);
		await proxy.setWorld(world, []);
		const registry = new StepRegistry([], world);
		proxy.injectInto(registry);
		const tool = registry.get(hostScopedMethodName(HOST, stepMethodName(EchoStepper.name, step)));
		if (!tool) throw new Error(`the proxy doesn't hold the host's step ${step}`);
		return tool;
	};
	/** The capability-invocation header each call to the host presented, keyed by method. */
	const presented = new Map<string, string | undefined>();

	beforeAll(async () => {
		// Start a minimal RPC server with EchoStepper
		world = getDefaultWorld() as TWorld;
		// Every step the host serves requires an action, so the proxy signs each call to a step as the holder it presents.
		const authority = new SessionAuthority();
		authority.registerInvoker(new FakeInvoker("proxy"));
		(world.runtime.keys ??= {})[AUTHORITY_KEY] = authority;
		// The host serves its declarations through the show steps step and dispatches that step like any other.
		const hosted = [new EchoStepper(), new Haibun()];
		for (const stepper of hosted) await stepper.setWorld(world, hosted);
		addStepperConcerns(world, hosted);
		const localRegistry = openRunRegistry(world, hosted);

		const app = new Hono();
		app.post("/rpc/:_method", async (c) => {
			const data = (await c.req.json()) as { method: string; params?: Record<string, unknown> };
			presented.set(data.method, c.req.header("capability-invocation"));
			if (data.method === ACTION_BEGIN) {
				return c.json(hostHandshake(HOST, `${SITE_DID_PREFIX}${HOST}`));
			}
			const tool = localRegistry.get(data.method);
			if (!tool) return c.json({ error: `not found: ${data.method}` }, 422);
			try {
				const featureStep = buildFeatureStepForTransport(tool, data.params ?? {}, [0, 1]);
				// The host grants the proxy every step it serves, so the proxy is shown every step and may call every step.
				const result = await runAuthorizedWith(RUN_AUTHORITY, () => tool.handler(featureStep, world));
				if (result.ok) return c.json(result.products ?? ANSWERED_WITHOUT_PRODUCTS);
				return c.json(callFailed(data.method, result.errorMessage), 422);
			} catch (err) {
				return c.json(callFailed(data.method, errorDetail(err)), 422);
			}
		});

		port = 18900 + Math.floor(Math.random() * 100);
		server = serve({ fetch: app.fetch, port });
	});

	afterAll(() => {
		server?.close();
	});

	it("fetches step descriptors from the remote host", async () => {
		const proxy = new RemoteStepperProxy(`http://localhost:${port}`);
		await proxy.setWorld(world, []);
		expect(proxy.descriptors.length).toBeGreaterThan(0);
		expect(proxy.descriptors.map((d) => d.method)).toContain("EchoStepper-echo");
	});

	it("injects proxy tools into registry under hostId-prefixed keys", async () => {
		const proxy = new RemoteStepperProxy(`http://localhost:${port}`);
		await proxy.setWorld(world, []);
		expect(proxy.remoteHostId).toBe(HOST);

		const registry = new StepRegistry([], world);
		proxy.injectInto(registry);

		// The key's prefix is the remote's hostId, so the key doesn't collide with local tools or other hosts' tools of the
		// same method name.
		const tool = registry.get("host7_EchoStepper-echo");
		if (!tool) throw new Error("Expected prefixed tool to be registered");
		// The bare local name isn't registered. Every remote tool is prefixed.
		expect(registry.get("EchoStepper-echo")).toBeUndefined();
		expect(tool.descriptor, "the host's step descriptor under its host-scoped method name, with the host's origin").toMatchObject({
			method: "host7_EchoStepper-echo",
			stepperName: "EchoStepper",
			stepperDescription: "Steps on a remote host that echo a message and respond to a protected ping.",
			pattern: `echo {message: ${DOMAIN_TEXT}}`,
			remoteOrigin: `http://localhost:${port}`,
			paramDomains: { message: DOMAIN_TEXT },
			read: false,
			fallback: false,
		});
		expect(tool.descriptor.inputSchema.required).toEqual(["message"]);

		const featureStep = buildFeatureStepForTransport(tool, { message: "hello" }, [0, 1]);
		const result = await tool.handler(featureStep, world);
		expect(result.ok).toBe(true);
		expect(result.products).toMatchObject({ echoed: "hello" });
	});

	it("doesn't return products for a step that doesn't declare them, whatever the host's response carries in their place", async () => {
		const tool = await hostTool("acts");
		expect(await tool.handler(buildFeatureStepForTransport(tool, {}, [0, 1]), world)).toEqual({ ok: true });
	});

	it("carries a call's object argument to the host as the object, not as its text", async () => {
		const tool = await hostTool("echoLabel");
		const result = await tool.handler(buildFeatureStepForTransport(tool, { query: { label: "Comment" } }, [0, 1]), world);
		expect(result.products).toMatchObject({ label: "Comment" });
	});

	it("sends the value a variable holds where the statement was written, not the variable's name", async () => {
		const tool = await hostTool("echo");
		await world.shared.set({ term: "greeting", value: "hello from the caller", domain: DOMAIN_STRING, origin: Origin.var }, { seq: [0], when: "test" });
		const featureStep = buildFeatureStepForTransport(tool, {}, [0, 1]);
		featureStep.action.stepValuesMap = { message: { term: "greeting", domain: DOMAIN_STRING, origin: Origin.defined } };
		const result = await tool.handler(featureStep, world);
		expect(result.products).toMatchObject({ echoed: "hello from the caller" });
	});

	it("sends a union parameter's coerced value to the host, not the resolved TStepValue", async () => {
		const tool = await hostTool("echoPick");
		const featureStep = buildFeatureStepForTransport(tool, {}, [0, 1]);
		featureStep.action.stepValuesMap = { pick: { term: "alpha", domain: DOMAIN_PICK, origin: Origin.quoted } };
		const result = await tool.handler(featureStep, world);
		expect(result.ok, result.errorMessage).toBe(true);
		expect(result.products).toMatchObject({ echoed: "alpha" });
	});

	it("states a step's failure on the host as the host states it and names the step once", async () => {
		const tool = await hostTool("refuses");
		const result = await tool.handler(buildFeatureStepForTransport(tool, {}, [0, 1]), world);
		expect(result.ok ? undefined : result.errorMessage).toBe(callFailed(stepMethodName(EchoStepper.name, "refuses"), REFUSED).error);
	});

	it("preserves capability metadata from the remote host", async () => {
		const tool = await hostTool("protectedPing");
		expect(tool.descriptor.capability).toBe("EchoStepper:admin");
	});

	it("signs each call for the step's declared action, for the step's own name where it doesn't declare one, and for a public read of the step list", async () => {
		const proxy = new RemoteStepperProxy(`http://localhost:${port}`);
		await proxy.setWorld(world, []);
		const registry = new StepRegistry([], world);
		proxy.injectInto(registry);
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
		expect(presented.get(ACTION_BEGIN), "and the handshake doesn't require an action").toBeUndefined();
	});
});
