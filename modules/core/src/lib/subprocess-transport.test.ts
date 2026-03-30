import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { getDefaultWorld } from "./test/lib.js";
import { SubprocessTransport } from "./subprocess-transport.js";
import { StepRegistry, buildSyntheticFeatureStep } from "./step-dispatch.js";
import { AStepper } from "./astepper.js";
import { OK } from "../schema/protocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The fixture must be pre-compiled JS (child process runs Node directly, not vitest transform).
// From modules/core/src/lib → modules/core/build/lib/test
const FIXTURE_PATH = join(__dirname, "..", "..", "build", "lib", "test", "subprocess-fixture.js");

describe("SubprocessTransport", () => {
	let transport: SubprocessTransport | undefined;

	afterEach(() => {
		transport?.kill();
		transport = undefined;
	});

	it("spawns child and receives step descriptors", async () => {
		const world = getDefaultWorld();
		transport = await SubprocessTransport.spawn(FIXTURE_PATH, world);
		expect(transport.descriptors.length).toBeGreaterThan(0);
		const methods = transport.descriptors.map((d) => d.method);
		expect(methods).toContain("EchoStepper-echo");
		expect(methods).toContain("EchoStepper-pong");
		expect(
			transport.descriptors.find((d) => d.method === "EchoStepper-pong")
				?.capability,
		).toBe("EchoStepper:protected");
	});

	it("injects proxy tools into StepRegistry", async () => {
		const world = getDefaultWorld();
		transport = await SubprocessTransport.spawn(FIXTURE_PATH, world);

		// Registry starts empty (no local steppers)
		const registry = new StepRegistry([], world);
		transport.injectInto(registry);

		expect(registry.has("EchoStepper-echo")).toBe(true);
		expect(registry.has("EchoStepper-pong")).toBe(true);
		expect(registry.get("EchoStepper-pong")?.capability).toBe(
			"EchoStepper:protected",
		);
	});

	it("dispatches a call and gets products back", async () => {
		const world = getDefaultWorld();
		transport = await SubprocessTransport.spawn(FIXTURE_PATH, world);

		const result = await transport.call("EchoStepper-echo", { message: "hello" }, [1, 2, 3]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.products.echoed).toBe("hello");
			// _seqPath should reflect the seqPath we sent
			expect(result.products._seqPath).toEqual([1, 2, 3]);
		}
	});

	it("returns error for unknown method", async () => {
		const world = getDefaultWorld();
		transport = await SubprocessTransport.spawn(FIXTURE_PATH, world);

		const result = await transport.call("NonExistent-step", {}, [0]);
		expect(result.ok).toBe(false);
		expect(result.errorMessage).toContain("Method not found");
	});

	it("seqPath [0,N] threading preserved for ad-hoc calls via registry", async () => {
		const world = getDefaultWorld();
		transport = await SubprocessTransport.spawn(FIXTURE_PATH, world);

		// Two sequential calls — seqPath should pass through via _seqPath in products
		const r1 = await transport.call("EchoStepper-echo", { message: "a" }, [0, 1]);
		const r2 = await transport.call("EchoStepper-echo", { message: "b" }, [0, 2]);
		expect(r1.ok).toBe(true);
		expect(r2.ok).toBe(true);
		expect(r1.products?._seqPath).toEqual([0, 1]);
		expect(r2.products?._seqPath).toEqual([0, 2]);
	});

	it("proxy handler in registry calls through to child", async () => {
		const world = getDefaultWorld();
		transport = await SubprocessTransport.spawn(FIXTURE_PATH, world);

		// Mix local and subprocess steps in the same registry
		class LocalStepper extends AStepper {
			steps = { local: { gwta: "local step", action: async () => OK } };
		}
		const registry = new StepRegistry([new LocalStepper()], world);
		transport.injectInto(registry);

		expect(registry.has("LocalStepper-local")).toBe(true);
		expect(registry.has("EchoStepper-echo")).toBe(true);

		const tool = registry.get("EchoStepper-echo");
		if (!tool) throw new Error("Expected subprocess tool to be injected");
		const featureStep = buildSyntheticFeatureStep(tool, { message: "from-registry" }, [5]);
		const result = await tool.handler(featureStep, world);
		expect(result.ok).toBe(true);
		expect(result.products?.echoed).toBe("from-registry");
	});
});
