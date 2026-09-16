import { describe, expect, it } from "vitest";
import { z } from "zod";
import { StepRegistry, type StepTool, buildFeatureStepForTransport, createStepTool, declaredSteppers, discoverSteps, hostScopedMethodName } from "./step-registry.js";
import { AStepper } from "./astepper.js";
import { actionOK } from "./util/index.js";
import type { TWorld } from "./world.js";
import type { TStepperStep } from "./astepper.js";
import { EVERY_DEFINITION, STEP_DETAIL, SHOW_STEPS_METHOD, StepDiscoverySchema, type TStepDefinitions, type TStepSummaries } from "./step-discovery.js";

/** A domain with date fields and a defaulted field: the shape every persisted type carries (generatedAtTime etc.). */
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

class RecordSteps extends AStepper {
	description = "steps that create records";
	steps = { createRecord: stepDef };
}

describe("step tool input schemas", () => {
	it("a domain-typed param surfaces the domain's full JSON Schema with input semantics: dates as string/date-time, defaulted fields optional", () => {
		const tool = createStepTool(new RecordSteps(), "createRecord", stepDef, worldWith(RecordSchema));
		const data = tool.descriptor.inputSchema.properties.data as { properties?: Record<string, { type?: string; format?: string }>; required?: string[] };
		expect(data.properties?.subject).toMatchObject({ type: "string" });
		expect(data.properties?.dateSent).toMatchObject({ type: "string", format: "date-time" });
		expect(data.required).toContain("dateSent");
		expect(data.required).not.toContain("generatedAtTime");
	});

	it("a domain declaring a type with no JSON Schema representation throws at registration, naming the domain and the type", () => {
		const unrepresentable = z.object({ handle: z.bigint() });
		expect(() => createStepTool(new RecordSteps(), "createRecord", stepDef, worldWith(unrepresentable))).toThrow(/test-record.*bigint.*no JSON Schema representation/);
	});
});

const emptyRegistryWorld = { domains: {}, runtime: {} } as unknown as TWorld;

/** A stepper with one plain step, standing in for what a run registers locally. */
class LocalSteps extends AStepper {
	description = "a step that passes";
	steps = { passes: { gwta: "passes", action: async () => actionOK() } };
}

/** A step another host declares, as its proxy registers it in this run's registry. */
const remoteTool = (stepName: string, pattern: string, capability?: string): StepTool => ({
	descriptor: {
		method: hostScopedMethodName(9, `RemoteSteps-${stepName}`),
		stepperName: "RemoteSteps",
		stepperDescription: "steps another host declares",
		stepName,
		pattern: `${pattern} (at localhost:8331)`,
		params: {},
		paramDomains: {},
		...(capability ? { capability } : {}),
		read: false,
		fallback: false,
		inputSchema: { type: "object", properties: {}, required: [] },
	},
	paramSchemas: new Map(),
	paramDomainKeys: new Map(),
	transport: "remote",
	remoteHost: "localhost:8331",
	isAsync: true,
	handler: async () => actionOK(),
});

const definitionsOf = (world: TWorld, registry: StepRegistry, text: string) => discoverSteps(world, registry, { text, detail: STEP_DETAIL.definition }) as TStepDefinitions;
const summariesOf = (world: TWorld, registry: StepRegistry, text: string) => discoverSteps(world, registry, { text, detail: STEP_DETAIL.summary }) as TStepSummaries;

describe("what a read of the run's declarations shows", () => {
	const emptyWorld = { domains: {}, runtime: {} } as unknown as TWorld;

	it("shows a step another host injected under its host-scoped name, with a pattern and a stepper that name the host", () => {
		const registry = new StepRegistry([new LocalSteps()], emptyWorld);
		registry.set(remoteTool("listTyped", "list {domain: string}"));
		const shown = definitionsOf(emptyWorld, registry, "");
		expect(shown.steps.find((step) => step.method === hostScopedMethodName(9, "RemoteSteps-listTyped"))?.pattern).toBe("list {domain: string} (at localhost:8331)");
		expect(shown.steps.find((step) => step.method === "LocalSteps-passes"), "beside the local steps").toBeDefined();
		expect(shown.steppers.map((entry) => entry.stepper)).toEqual(["LocalSteps", "host9_RemoteSteps"]);
	});

	it("shows every step with the capability it requires, whatever the caller holds", () => {
		const registry = new StepRegistry([new LocalSteps()], emptyWorld);
		registry.set(remoteTool("write", "write {data}", "Remote:write"));
		expect(definitionsOf(emptyWorld, registry, "write").steps.map((step) => step.capability)).toEqual(["Remote:write"]);
	});

	it("shows the steps and domains whose text contains the text without regard to case, and the steppers of the steps that matched", () => {
		class ManySteps extends AStepper {
			description = "steps that read and write records";
			steps = {
				readRecord: { gwta: "read record {id}", description: "Reads one record.", action: async () => actionOK() },
				writeRecord: { gwta: "write record {id}", action: async () => actionOK() },
			};
		}
		const world = {
			runtime: {},
			domains: {
				"record-id": { selectors: ["record-id"], schema: z.string(), description: "the id of a record" },
				colour: { selectors: ["colour"], schema: z.string(), description: "a colour" },
			},
		} as unknown as TWorld;
		const registry = new StepRegistry([new ManySteps(), new LocalSteps()], world);
		const byStepper = summariesOf(world, registry, "manysteps-");
		expect(StepDiscoverySchema.parse(byStepper)).toEqual(byStepper);
		expect(byStepper.steps.map((step) => step.method), "a stepper's name and a hyphen match its steps").toEqual(["ManySteps-readRecord", "ManySteps-writeRecord"]);
		expect(byStepper.steppers, "with the stepper whose steps matched, how many matched, and the read of its steps").toEqual([
			{ stepper: "ManySteps", description: "steps that read and write records", steps: 2, _links: { steps: { method: SHOW_STEPS_METHOD, params: { text: "ManySteps-", detail: "summary" } } } },
		]);
		expect(byStepper.steps[0], "a summary names the step, says what it does and links its definition").toEqual({
			method: "ManySteps-readRecord",
			stepperName: "ManySteps",
			pattern: "read record {id}",
			description: "Reads one record.",
			_links: { definition: { method: SHOW_STEPS_METHOD, params: { text: "ManySteps-readRecord", detail: "definition" } } },
		});
		const defined = definitionsOf(world, registry, "reads ONE");
		expect(StepDiscoverySchema.parse(defined)).toEqual(defined);
		expect(defined.steps.map((step) => step.method), "a step's description is matched without regard to case").toEqual(["ManySteps-readRecord"]);
		expect(defined.steps[0]._links.call, "and a definition links the step's call").toEqual({ method: "ManySteps-readRecord" });
		expect(defined.steps[0].inputSchema.required, "with the schema of its arguments").toEqual(["id"]);
		expect(summariesOf(world, registry, "record").domains.map((entry) => entry.domain), "a domain is matched by its name or description").toEqual(["record-id"]);
		expect(declaredSteppers(registry).map((entry) => [entry.stepper, entry.steps]), "and the run's steppers are every stepper with every step").toEqual([
			["ManySteps", 2],
			["LocalSteps", 1],
		]);
	});

	it("names a host-scoped step so a model can call it: letters, digits, underscores and hyphens only", () => {
		expect(hostScopedMethodName(9, "RemoteSteps-listTyped")).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});

describe("a call by name of another host's step", () => {
	it("carries the host, so dispatch resolves that host's step and not the local one of the same name", () => {
		expect(buildFeatureStepForTransport(remoteTool("listTyped", "list {domain: string}"), { domain: "thing" }, [0, -1, 1]).targetHostId, "the host the tool is registered under").toBe(9);
		const local = new StepRegistry([new LocalSteps()], emptyRegistryWorld).get("LocalSteps-passes");
		if (!local) throw new Error("the local step is not registered");
		expect(buildFeatureStepForTransport(local, {}, [0, -1, 2]).targetHostId, "and nothing for a step of this run").toBeUndefined();
	});
});

describe("what the manifest says about a domain", () => {
	// A domain that presents a component names where its source is served from; the source itself stays on the server,
	// where the standalone report inlines it. A manifest that carried it would send a bundle to every caller, on every boot.
	it("carries the component and its URL, never the component's source", () => {
		const world = {
			runtime: {},
			domains: { "x-viewer": { name: "x-viewer", description: "a viewer", ui: { component: "x-viewer", js: "/assets/x-viewer.js", jsContent: "/* the whole bundle */" } } },
		} as unknown as TWorld;
		const manifest = discoverSteps(world, new StepRegistry([], world), EVERY_DEFINITION) as TStepDefinitions;
		expect(manifest.domains["x-viewer"].ui).toEqual({ component: "x-viewer", js: "/assets/x-viewer.js" });
	});
});
