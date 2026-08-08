import { describe, expect, it } from "vitest";
import { z } from "zod";
import { StepRegistry, type StepTool, buildFeatureStepForTransport, createStepTool, discoverSteps, hostScopedMethodName } from "./step-registry.js";
import { AStepper } from "./astepper.js";
import { actionOK } from "./util/index.js";
import type { TWorld } from "./world.js";
import type { TStepperStep } from "./astepper.js";

/** A domain with date fields and a defaulted field — the shape every persisted type carries (generatedAtTime etc.). */
const RecordSchema = z
	.object({
		subject: z.string(),
		dateSent: z.coerce.date(),
		generatedAtTime: z.coerce.date().default(() => new Date()),
	})
	.strict();

const worldWith = (schema: z.ZodType): TWorld =>
	({
		domains: {
			"test-record": { selectors: ["test-record"], schema, description: "A dated test record." },
		},
	}) as unknown as TWorld;

const stepDef = { gwta: "create record {data: test-record}", action: async () => actionOK() } as unknown as TStepperStep;

describe("step tool input schemas", () => {
	it("a domain-typed param surfaces the domain's full JSON Schema with input semantics: dates as string/date-time, defaulted fields optional", () => {
		const tool = createStepTool("TestStepper", "createRecord", stepDef, worldWith(RecordSchema));
		const data = tool.inputSchema.properties?.data as { properties?: Record<string, { type?: string; format?: string }>; required?: string[] };
		expect(data.properties?.subject).toMatchObject({ type: "string" });
		expect(data.properties?.dateSent).toMatchObject({ type: "string", format: "date-time" });
		expect(data.required).toContain("dateSent");
		expect(data.required).not.toContain("generatedAtTime");
	});

	it("a domain declaring a type with no JSON Schema representation throws at registration, naming the domain and the type", () => {
		const unrepresentable = z.object({ handle: z.bigint() });
		expect(() => createStepTool("TestStepper", "createRecord", stepDef, worldWith(unrepresentable))).toThrow(/test-record.*bigint.*no JSON Schema representation/);
	});
});

/** A stepper with one plain step, standing in for what a run registers locally. */
class LocalSteps extends AStepper {
	steps = { passes: { gwta: "passes", action: async () => actionOK() } };
}

describe("what the manifest describes", () => {
	const emptyWorld = { domains: {}, runtime: {} } as unknown as TWorld;

	it("carries a step another host injected, since dispatch can reach it and a reader must be able to learn of it", () => {
		const steppers = [new LocalSteps()];
		const registry = new StepRegistry(steppers, emptyWorld);
		const injected: StepTool = {
			name: hostScopedMethodName(9, "RemoteSteps-listTyped"),
			description: "list {domain: string}",
			inputSchema: { type: "object" },
			paramSchemas: new Map(),
			paramDomainKeys: new Map(),
			stepperName: "RemoteSteps",
			stepName: "listTyped",
			isAsync: true,
			transport: "remote",
			remoteHost: "localhost:8331",
			handler: async () => actionOK(),
		} as unknown as StepTool;
		registry.set(injected);
		const manifest = discoverSteps(steppers, emptyWorld, registry);
		const entry = manifest.steps.find((step) => step.method === injected.name);
		expect(entry, "the injected step is in the manifest under its host-scoped name").toBeDefined();
		expect(entry?.pattern, "and its pattern says whose it is").toBe("list {domain: string} (at localhost:8331)");
		expect(
			manifest.steps.find((step) => step.method === "LocalSteps-passes"),
			"beside the local steps",
		).toBeDefined();
	});

	it("filters an injected step by its capability like any other", () => {
		const steppers = [new LocalSteps()];
		const registry = new StepRegistry(steppers, emptyWorld);
		registry.set({
			name: hostScopedMethodName(9, "Gated-write"),
			description: "write {data}",
			inputSchema: { type: "object" },
			paramSchemas: new Map(),
			paramDomainKeys: new Map(),
			stepperName: "Gated",
			stepName: "write",
			capability: "Remote:write",
			isAsync: true,
			transport: "remote",
			handler: async () => actionOK(),
		} as unknown as StepTool);
		const withheld = discoverSteps(steppers, emptyWorld, registry, { grantedCapability: "Remote:read" });
		expect(withheld.steps.find((step) => step.method === hostScopedMethodName(9, "Gated-write"))).toBeUndefined();
		const granted = discoverSteps(steppers, emptyWorld, registry, { grantedCapability: "Remote:write" });
		expect(granted.steps.find((step) => step.method === hostScopedMethodName(9, "Gated-write"))).toBeDefined();
	});

	it("names a host-scoped step so a model can call it: letters, digits, underscores and hyphens only", () => {
		expect(hostScopedMethodName(9, "RemoteSteps-listTyped")).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});

describe("a call by name of another host's step", () => {
	it("carries the host, so dispatch resolves that host's step and not the local one of the same name", () => {
		const built = buildFeatureStepForTransport(
			{ name: hostScopedMethodName(9, "RemoteSteps-listTyped"), description: "list {domain: string}", stepperName: "RemoteSteps", stepName: "listTyped" } as StepTool,
			{ domain: "thing" },
			[0, -1, 1],
		);
		expect(built.targetHostId, "the host the tool is registered under").toBe(9);
		expect(
			buildFeatureStepForTransport(
				{ name: "RemoteSteps-listTyped", description: "list {domain: string}", stepperName: "RemoteSteps", stepName: "listTyped" } as StepTool,
				{},
				[0, -1, 2],
			).targetHostId,
			"and nothing for a step of this run",
		).toBeUndefined();
	});
});
