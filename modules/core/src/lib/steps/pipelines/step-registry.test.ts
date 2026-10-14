import { describe, expect, it } from "vitest";
import { z } from "zod";
import { StepRegistry, type StepTool, createStepHandler, createStepTool } from "./step-registry.js";
import { buildFeatureStepForTransport } from "./call-step.js";
import { refusal } from "./gate.js";
import { discoverSteps, steppersOf } from "../derivations/discover-steps.js";
import { hostScopedMethodName } from "../domains/step-method.js";
import { AStepper, type TFeatureStep } from "../domains/stepper.js";
import { actionNotOK, actionOK } from "../../util/index.js";
import { RefusedCall } from "../../rpc-wire.js";
import { typeCollectionRemedy } from "../../typed-links.js";
import { getDefaultWorld } from "../../test/lib.js";
import type { TWorld } from "../../actuality/domains/world.js";
import type { TStepperStep } from "../domains/stepper.js";
import { EVERY_DEFINITION, STEP_DETAIL, SHOW_STEPS_METHOD, StepDiscoverySchema } from "../domains/step-discovery.js";
import { RUN_AUTHORITY } from "../../capability-context.js";

/** A domain with date fields and a defaulted field. A persisted type's generatedAtTime is a defaulted date field. */
const RecordSchema = z.object({ subject: z.string(), dateSent: z.coerce.date(), generatedAtTime: z.coerce.date().default(() => new Date()) }).strict();

const worldWith = (schema: z.ZodType): TWorld => ({ domains: { "test-record": { selectors: ["test-record"], schema, description: "A dated test record." } } }) as unknown as TWorld;

const stepDef = { gwta: "create record {data: test-record}", action: async () => actionOK() } as unknown as TStepperStep;

class RecordSteps extends AStepper {
	description = "steps that create records";
	steps = { createRecord: stepDef };
}

describe("step tool input schemas", () => {
	it("a domain-typed param's schema is the domain's full JSON Schema for input, with dates as string/date-time and defaulted fields optional", () => {
		const tool = createStepTool(new RecordSteps(), "createRecord", stepDef, worldWith(RecordSchema));
		const data = tool.descriptor.inputSchema.properties.data as { properties?: Record<string, { type?: string; format?: string }>; required?: string[] };
		expect(data.properties?.subject).toMatchObject({ type: "string" });
		expect(data.properties?.dateSent).toMatchObject({ type: "string", format: "date-time" });
		expect(data.required).toContain("dateSent");
		expect(data.required).not.toContain("generatedAtTime");
	});

	it("registration throws for a domain that declares a type without a JSON Schema form, and the error names the domain and the type", () => {
		const unrepresentable = z.object({ handle: z.bigint() });
		expect(() => createStepTool(new RecordSteps(), "createRecord", stepDef, worldWith(unrepresentable))).toThrow(
			/test-record" declares a "bigint" field\. JSON Schema doesn't represent that type/,
		);
	});
});

const emptyRegistryWorld = { domains: {}, runtime: {} } as unknown as TWorld;

/** A stepper with one plain step. It stands for the steps actuality registers locally. */
class LocalSteps extends AStepper {
	description = "a step that passes";
	steps = { passes: { gwta: "passes", action: async () => actionOK() } };
}

/** A step that another host declares, as its proxy registers it in actuality's registry. */
const remoteTool = (stepName: string, pattern: string, capability = `RemoteSteps:${stepName}`): StepTool => ({
	descriptor: {
		method: hostScopedMethodName(9, `RemoteSteps-${stepName}`),
		stepperName: "RemoteSteps",
		stepperDescription: "steps another host declares",
		stepName,
		pattern,
		paramDomains: {},
		capability,
		read: false,
		fallback: false,
		answersTheTurn: false,
		remoteOrigin: "http://localhost:8331",
		inputSchema: { type: "object", properties: {}, required: [] },
	},
	paramDomainKeys: new Map(),
	transport: "remote",
	isAsync: true,
	handler: async () => actionOK(),
});

/** The definitions shown to a caller holding `held`. `held` defaults to RUN_AUTHORITY. Actuality's own feature holds
 *  RUN_AUTHORITY, which allows every action. */
const definitionsOf = (world: TWorld, registry: StepRegistry, text: string, held: string[] = RUN_AUTHORITY) =>
	discoverSteps(world, registry, { text, detail: STEP_DETAIL.definition }, held);
const summariesOf = (world: TWorld, registry: StepRegistry, text: string) => discoverSteps(world, registry, { text, detail: STEP_DETAIL.summary }, RUN_AUTHORITY);

describe("what a read of actuality's declarations shows", () => {
	const emptyWorld = { domains: {}, runtime: {} } as unknown as TWorld;

	it("shows an injected step of another host under its host-scoped name, with that host's origin and a stepper name that includes the host", () => {
		const registry = new StepRegistry([new LocalSteps()], emptyWorld);
		registry.inject([remoteTool("listTyped", "list {domain: string}")]);
		const shown = definitionsOf(emptyWorld, registry, "");
		expect(shown.steps.find((step) => step.method === hostScopedMethodName(9, "RemoteSteps-listTyped"))).toMatchObject({
			pattern: "list {domain: string}",
			remoteOrigin: "http://localhost:8331",
		});
		expect(
			shown.steps.find((step) => step.method === "LocalSteps-passes"),
			"beside the local steps",
		).toBeDefined();
		expect(shown.steppers.map((entry) => entry.stepper)).toEqual(["LocalSteps", "host9_RemoteSteps"]);
	});

	it("shows a caller only the steps whose required action it holds, each with that action", () => {
		const registry = new StepRegistry([new LocalSteps()], emptyWorld);
		registry.inject([remoteTool("write", "write {data}", "Remote:write"), remoteTool("read", "read {data}", "Read:private")]);
		expect(
			definitionsOf(emptyWorld, registry, "", ["Remote:write"]).steps.map((step) => step.capability),
			"one it holds, and doesn't show a step it may not call",
		).toEqual(["Remote:write"]);
		expect(definitionsOf(emptyWorld, registry, "", ["Read:opened"]).steps, "a narrower read doesn't allow a broader one").toEqual([]);
		expect(definitionsOf(emptyWorld, registry, "", []).steps, "and a caller that doesn't hold an action isn't shown a step").toEqual([]);
		expect(
			definitionsOf(emptyWorld, registry, "").steppers.map((entry) => entry.stepper),
			"actuality is shown every step",
		).toEqual(["LocalSteps", "host9_RemoteSteps"]);
	});

	it("shows the steps and domains whose text contains the text without regard to case, and the steppers of the steps that matched", () => {
		class ManySteps extends AStepper {
			description = "steps that read and write records";
			steps = {
				readRecord: { gwta: "read record {id: record-key}", description: "Reads one record.", action: async () => actionOK() },
				writeRecord: { gwta: "write record {id: record-key}", action: async () => actionOK() },
			};
		}
		const world = {
			runtime: {},
			domains: {
				"record-key": { selectors: ["record-key"], schema: z.string(), description: "the id of a record" },
				colour: { selectors: ["colour"], schema: z.string(), description: "a colour" },
			},
		} as unknown as TWorld;
		const registry = new StepRegistry([new ManySteps(), new LocalSteps()], world);
		const byStepper = summariesOf(world, registry, "manysteps-");
		expect(StepDiscoverySchema.parse(byStepper)).toEqual(byStepper);
		expect(
			byStepper.steps.map((step) => step.method),
			"a stepper's name and a hyphen match its steps",
		).toEqual(["ManySteps-readRecord", "ManySteps-writeRecord"]);
		expect(byStepper.steppers, "with the stepper whose steps matched, how many matched, and the link that reads its steps").toEqual([
			{
				stepper: "ManySteps",
				description: "steps that read and write records",
				steps: 2,
				_links: { steps: { method: SHOW_STEPS_METHOD, params: { text: "ManySteps-", detail: "summary" } } },
			},
		]);
		expect(byStepper.steps[0], "a summary names the step, states what it does and links its definition").toEqual({
			method: "ManySteps-readRecord",
			stepperName: "ManySteps",
			pattern: "read record {id: record-key}",
			description: "Reads one record.",
			capability: "ManySteps:readRecord",
			_links: { definition: { method: SHOW_STEPS_METHOD, params: { text: "ManySteps-readRecord", detail: "definition" } } },
		});
		const defined = definitionsOf(world, registry, "reads ONE");
		expect(StepDiscoverySchema.parse(defined)).toEqual(defined);
		expect(
			defined.steps.map((step) => step.method),
			"a step's description is matched without regard to case",
		).toEqual(["ManySteps-readRecord"]);
		const [readRecord] = defined.steps;
		expect(readRecord?._links.call, "and a definition links the step's call").toEqual({ method: "ManySteps-readRecord" });
		expect(readRecord?.inputSchema.required, "with the schema of its arguments").toEqual(["id"]);
		expect(Object.keys(summariesOf(world, registry, "record").domains), "a domain is matched by its name or description").toEqual(["record-key"]);
		expect(
			steppersOf(registry.descriptors()).map((entry) => [entry.stepper, entry.steps]),
			"and actuality's steppers are every stepper with every step",
		).toEqual([
			["ManySteps", 2],
			["LocalSteps", 1],
		]);
	});

	it("calls its change listeners once for each injection or rebuild that changes the descriptors, and not for one that keeps them", () => {
		const steppers = [new LocalSteps()];
		const registry = new StepRegistry(steppers, emptyWorld);
		let changes = 0;
		registry.onChange(() => changes++);
		registry.inject([remoteTool("listTyped", "list {domain: string}"), remoteTool("write", "write {data}")]);
		expect(changes, "two steps injected together are one change").toBe(1);
		registry.inject([remoteTool("listTyped", "list {domain: string}")]);
		expect(changes, "a step injected again as it was doesn't change the registry").toBe(1);
		registry.refresh(steppers, emptyWorld);
		expect(changes, "and a rebuild of the same steps doesn't either").toBe(1);
		class MoreSteps extends AStepper {
			description = "a step that a rebuild adds";
			steps = { fails: { gwta: "fails", action: async () => actionOK() } };
		}
		registry.refresh([...steppers, new MoreSteps()], emptyWorld);
		expect(changes, "a rebuild that adds a step is a change").toBe(2);
	});

	it("names a host-scoped step so a model can call it: letters, digits, underscores and hyphens only", () => {
		expect(hostScopedMethodName(9, "RemoteSteps-listTyped")).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});

describe("a call by name of another host's step", () => {
	it("carries the host, so dispatch resolves that host's step and not the local one of the same name", () => {
		expect(
			buildFeatureStepForTransport(remoteTool("listTyped", "list {domain: string}"), { domain: "thing" }, [0, -1, 1]).targetHostId,
			"the host id from the tool's host-scoped name",
		).toBe(9);
		const local = new StepRegistry([new LocalSteps()], emptyRegistryWorld).get("LocalSteps-passes");
		if (!local) throw new Error("the local step is not registered");
		expect(buildFeatureStepForTransport(local, {}, [0, -1, 2]).targetHostId, "and undefined for a local step").toBeUndefined();
	});
});

describe("what the manifest states about a domain", () => {
	// A domain that presents a component names the URL that serves its source. The source stays on the server, and the
	// standalone report inlines it. A manifest that carried the source would send a bundle to every caller on every boot.
	it("carries the component and its URL, never the component's source", () => {
		const world = {
			runtime: {},
			domains: {
				"x-viewer": {
					name: "x-viewer",
					schema: z.object({}),
					description: "a viewer",
					ui: { component: "x-viewer", js: "/assets/x-viewer.js", jsContent: "/* the whole bundle */" },
				},
			},
		} as unknown as TWorld;
		const manifest = discoverSteps(world, new StepRegistry([], world), EVERY_DEFINITION, RUN_AUTHORITY);
		expect(manifest.domains["x-viewer"]?.ui).toEqual({ component: "x-viewer", js: "/assets/x-viewer.js" });
	});
});

describe("the refusal a caller from outside actuality receives", () => {
	it("states only that a caller without a proven key may not make the call, whether the step exists or not", () => {
		expect(refusal("Pool-drain", "Pool:drain", undefined).error).toBe(refusal("Pool-nowhere", undefined, undefined).error.replace("Pool-nowhere", "Pool-drain"));
		expect(JSON.stringify(refusal("Pool-drain", "Pool:drain", undefined)), "and doesn't name an action the caller could request").not.toContain("Pool:drain");
	});

	it("names the action a caller with a proven key lacks with its request as the remedy, or states that the step doesn't exist", () => {
		expect(refusal("Pool-drain", "Pool:drain", "did:key:zSwimmer")).toEqual({ error: "Pool-drain: capability Pool:drain required", remedy: { do: "request", action: "Pool:drain" } });
		expect(refusal("Pool-nowhere", undefined, "did:key:zSwimmer")).toEqual({
			error: "Pool-nowhere: actuality doesn't register a step of this method; show steps lists the methods it registers",
		});
	});
});

describe("a step's refusal", () => {
	class RefusingStepper extends AStepper {
		description = "Refuses with a remedy, and throws a refused call.";
		steps = {
			refuses: { exact: "refuses", action: () => actionNotOK("the record isn't held", { remedy: typeCollectionRemedy("Letter") }) },
			throwsARefusal: { exact: "throws a refusal", action: () => Promise.reject(new RefusedCall({ error: "a call refused", remedy: { do: "request", action: "Pool:drain" } })) },
		};
	}

	it("carries the remedy a step states, and the remedy a refused call it threw carries (CA1G6)", async () => {
		const world = getDefaultWorld();
		const stepper = new RefusingStepper();
		const featureStepOf = (name: keyof RefusingStepper["steps"]): TFeatureStep => ({ in: name, seqPath: [0, 1], action: { stepperName: "RefusingStepper", actionName: name, step: stepper.steps[name] } });
		const refused = await createStepHandler("RefusingStepper", "refuses", stepper.steps.refuses)(featureStepOf("refuses"), world);
		expect(refused).toMatchObject({ ok: false, remedy: { do: "open", ref: { kind: "domain", target: { domain: "Letter" } } } });
		const thrown = await createStepHandler("RefusingStepper", "throwsARefusal", stepper.steps.throwsARefusal)(featureStepOf("throwsARefusal"), world);
		expect(thrown).toMatchObject({ ok: false, errorMessage: "the step threw: a call refused (request Pool:drain from a key that delegates it)", remedy: { do: "request", action: "Pool:drain" } });
	});
});
