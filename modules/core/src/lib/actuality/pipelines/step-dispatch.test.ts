import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";

import { dispatchStep } from "./step-dispatch.js";
import { retainedProducts } from "../derivations/step-results.js";
import { buildStepRegistry, createStepHandler, StepRegistry, type StepTool } from "../../steps/pipelines/step-registry.js";
import { stepMethodName } from "../../steps/domains/step-method.js";
import { discoverSteps } from "../../steps/derivations/discover-steps.js";
import { buildFeatureStepForTransport } from "../../steps/pipelines/call-step.js";
import { authorizeToolCapability } from "../../steps/pipelines/gate.js";
import { validateToolInput } from "../../steps/derivations/tool-validation.js";
import { EVERY_DEFINITION } from "../../steps/domains/step-discovery.js";
import { AStepper, type IHasCycles, type TFeatureStep, type TStepperStep } from "../../steps/domains/stepper.js";
import { OK, RECORDED_STATUS } from "../../domains/protocol.js";
import { itemAt } from "../../util/item-at.js";
import { FlowRunner } from "../../steps/pipelines/flow-runner.js";
import { actionOKWithProducts, actionNotOK } from "../../util/index.js";
import { getDefaultWorld, testWithWorld } from "../../test/lib.js";
import { TEST_DOMAIN, declaresTestDomains, testDomainDefinitions } from "../../test/test-domains.js";
import { DOMAIN_DOMAIN_KEY, DOMAIN_JSON, DOMAIN_NUMBER, DOMAIN_RECORD_ID, DOMAIN_STRING, individualRefDomain, registerDomains } from "../../domains/domains.js";
import type { TWorld } from "../domains/world.js";
import { Access, DOMAIN_PERSISTED_TYPE, LinkRelations, PersistedVertexSchema, SEQ_PATH_LABEL, type TDomainDefinition } from "../../resources.js";
import { SEQ_PATH_FIELD, executionOf, factIdOf, formatRecordName } from "../domains/seq-path.js";
import { readFacts } from "../../records/pipelines/facts.js";
import { streamContext, streamOver } from "../../transport/domains/step-stream-context.js";
import { capabilityAllows } from "../../actions.js";
import { RUN_AUTHORITY, readingAt, runActingAs, runReadingAt, WITHOUT_READ_REFUSAL } from "../../capability-context.js";

// --- Test Steppers ---

class PlainStepper extends AStepper {
	description = "A step that takes a name and returns OK.";
	steps = {
		greet: {
			gwta: "say hello to {name}",
			action: ({ name }: { name: string }) => {
				return OK;
			},
		},
	};
}

class ProductStepper extends AStepper {
	description = "Steps that return a count, fail and throw, for the dispatch tests.";
	cycles = declaresTestDomains();
	steps = {
		getCount: {
			gwta: "get the count",
			productsDomain: TEST_DOMAIN.count,
			action: () => {
				return actionOKWithProducts({ count: 42 });
			},
		},
		failStep: {
			gwta: "fail on purpose",
			action: () => {
				return actionNotOK("intentional failure");
			},
		},
		throwStep: {
			gwta: "throw an error",
			action: () => {
				throw new Error("boom");
			},
		},
	};
}

/** A tool a transport carries without the step's definition, as a remote host's tool arrives. */
const carrierTool = (stepperName: string, stepName: string, pattern: string, paramDomains: Record<string, string>): StepTool => ({
	descriptor: {
		method: stepMethodName(stepperName, stepName),
		stepperName,
		stepperDescription: "a stepper a transport names",
		stepName,
		pattern,
		paramDomains,
		capability: `${stepperName}:${stepName}`,
		read: false,
		fallback: false,
		answersTheTurn: false,
		inputSchema: { type: "object", properties: {}, required: [] },
	},
	paramDomainKeys: new Map(Object.entries(paramDomains)),
	transport: "remote",
	isAsync: true,
	handler: async () => OK,
});

const [COUNT, COUNT_UNNAMED, ANSWER_AS, PASS_ON, ANSWER_WRONGLY] = ["count", "count unnamed", "answer as", "pass on", "answer wrongly as"];

/** Steps that return a count, steps that run a statement and return its products with or without declaring productsOf,
 *  and a step that declares productsOf and returns other products. */
class PassesOn extends AStepper implements IHasCycles {
	description = "Steps that return a count, steps that run a statement and return its products, and a step that returns other products.";
	cycles = declaresTestDomains();
	private runner!: FlowRunner;
	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.runner = new FlowRunner(world, steppers);
	}
	private ran = ({ what }: { what: TFeatureStep[] }, featureStep: TFeatureStep) => this.runner.runSteps(what, { parentStep: featureStep });
	steps = {
		counts: { gwta: COUNT, productsDomain: TEST_DOMAIN.count, action: async () => actionOKWithProducts({ count: 1 }) },
		unnamed: { gwta: COUNT_UNNAMED, action: async () => actionOKWithProducts({ count: 1 }) },
		answersAs: { gwta: `${ANSWER_AS} {what: statement}`, productsOf: "what", action: this.ran },
		passesOn: { gwta: `${PASS_ON} {what: statement}`, action: this.ran },
		answersWrongly: { gwta: `${ANSWER_WRONGLY} {what: statement}`, productsOf: "what", action: async () => actionOKWithProducts({ said: "no count" }) },
	};
}

class CapabilityStepper extends AStepper {
	description = "A step that requires CapabilityStepper:protected.";
	steps = { protectedPing: { gwta: "protected ping", capability: "CapabilityStepper:protected", action: () => OK } };
}

/** Returns the value of the count fact of the step at `path`, or undefined where working memory doesn't hold one. */
const countFact = async (world: TWorld, path: number[]) =>
	(await readFacts(world.shared.getStore(), TEST_DOMAIN.count)).find((fact) => fact.id === factIdOf({ execution: executionOf(world.tag), path }))?.value;

describe("step-dispatch", () => {
	let world: TWorld;

	beforeEach(() => {
		world = getDefaultWorld();
		registerDomains(world, [testDomainDefinitions]);
	});

	describe("stepMethodName", () => {
		it("creates name from strings", () => {
			expect(stepMethodName("MyStepper", "doThing")).toBe("MyStepper-doThing");
		});

		it("creates name from AStepper instance", () => {
			const stepper = new PlainStepper();
			expect(stepMethodName(stepper, "greet")).toBe("PlainStepper-greet");
		});

		it("creates name from object with name", () => {
			expect(stepMethodName({ name: "Foo" }, "bar")).toBe("Foo-bar");
		});
	});

	describe("buildStepRegistry", () => {
		it("registers exposed steps", () => {
			const stepper = new PlainStepper();
			const registry = buildStepRegistry([stepper], world);
			expect(registry.has("PlainStepper-greet")).toBe(true);
		});

		it("includes outputSchema when defined", () => {
			const stepper = new ProductStepper();
			const registry = buildStepRegistry([stepper], world);
			const tool = registry.get("ProductStepper-getCount");
			expect(tool?.descriptor.outputSchema).toBeDefined();
		});

		it("builds input schema with required params", () => {
			const stepper = new PlainStepper();
			const registry = buildStepRegistry([stepper], world);
			const tool = registry.get("PlainStepper-greet");
			expect(tool?.descriptor.inputSchema.required).toContain("name");
			expect(tool?.descriptor.inputSchema.properties.name).toBeDefined();
		});

		it("propagates step capability metadata", () => {
			const stepper = new CapabilityStepper();
			const registry = buildStepRegistry([stepper], world);
			expect(registry.get("CapabilityStepper-protectedPing")?.descriptor.capability).toBe("CapabilityStepper:protected");
		});
	});

	describe("authorizeToolCapability", () => {
		it("allows exact capability match", () => {
			expect(capabilityAllows("CapabilityStepper:protected", "CapabilityStepper:protected")).toBe(true);
		});

		it("allows wildcard capability prefix", () => {
			expect(capabilityAllows("CapabilityStepper:*", "CapabilityStepper:protected")).toBe(true);
		});

		it("allows a required capability from a grant set", () => {
			expect(capabilityAllows(["Other:*", "CapabilityStepper:protected"], "CapabilityStepper:protected")).toBe(true);
		});

		it("rejects missing or wrong capability", () => {
			const tool = { method: "CapabilityStepper-protectedPing", capability: "CapabilityStepper:protected" };
			expect(() => authorizeToolCapability(tool, { invoked: undefined, held: undefined }, undefined)).toThrow(/capability CapabilityStepper:protected required/);
			expect(() => authorizeToolCapability(tool, { invoked: "Other:*", held: "Other:*" }, undefined)).toThrow(/capability CapabilityStepper:protected required/);
		});

		it("authorizes a call for the action it invoked, and not for another its caller holds", () => {
			const tool = { method: "CapabilityStepper-protectedPing", capability: "CapabilityStepper:protected" };
			const held = ["CapabilityStepper:protected", "LlmStepper:ask"];
			expect(() => authorizeToolCapability(tool, { invoked: "LlmStepper:ask", held }, undefined)).toThrow(/capability CapabilityStepper:protected required/);
			expect(() => authorizeToolCapability(tool, { invoked: "CapabilityStepper:protected", held }, undefined)).not.toThrow();
		});

		it("refuses a step that reads above its caller's read or above the read ceiling in force for the call", () => {
			const tool = { method: "CapabilityStepper-look", capability: "CapabilityStepper:look", readsAt: Access.private };
			const invoked = "CapabilityStepper:look";
			expect(() => authorizeToolCapability(tool, { invoked, held: [invoked, "Read:public"] }, undefined)).toThrow(/capability Read:private required/);
			expect(() => authorizeToolCapability(tool, { invoked, held: [invoked, "Read:private"] }, undefined), "the read is bounded by what the caller holds").not.toThrow();
			expect(() => authorizeToolCapability(tool, { invoked: "*", held: "*" }, Access.public)).toThrow("CapabilityStepper-look reads at private, and this call reads at public");
			expect(() => authorizeToolCapability(tool, { invoked: "*", held: "*" }, Access.private)).not.toThrow();
		});
	});

	describe("validateToolInput", () => {
		const toolTaking = (gwta: string, w: TWorld) => {
			const stepper = new (class extends AStepper {
				description = "A step whose pattern each validation test supplies.";
				steps = { test: { gwta, action: async () => OK } };
			})();
			const tool = buildStepRegistry([stepper], w).get(`${stepper.constructor.name}-test`);
			if (!tool) throw new Error("Expected tool to be registered");
			return tool;
		};

		it("passes valid input", () => {
			const w = getDefaultWorld();
			expect(validateToolInput([], toolTaking(`test {x: ${DOMAIN_STRING}}`, w), { x: "hello" }, w).x).toBe("hello");
		});

		it("throws on missing required input", () => {
			const w = getDefaultWorld();
			expect(() => validateToolInput([], toolTaking(`test {x: ${DOMAIN_STRING}}`, w), {}, w)).toThrow(/validation failed.*"x": required/);
		});

		it("throws on invalid type", () => {
			const w = getDefaultWorld();
			expect(() => validateToolInput([], toolTaking(`test {x: ${DOMAIN_NUMBER}}`, w), { x: "not-a-number" }, w)).toThrow(/validation failed/);
		});

		it("takes a domain registered after the registry was built", () => {
			const w = getDefaultWorld();
			registerDomains(w, []);
			const tool = toolTaking(`test {x: ${DOMAIN_DOMAIN_KEY}}`, w);
			const LATER = "declared-later";
			expect(() => validateToolInput([], tool, { x: LATER }, w), "before it is declared").toThrow(/validation failed/);
			registerDomains(w, [[{ selectors: [LATER], schema: z.string(), description: "a domain a feature declares" }]]);
			expect(validateToolInput([], tool, { x: LATER }, w).x).toBe(LATER);
		});

		it("doesn't list the domains or types that a domain or type parameter takes, and refuses an unregistered domain", () => {
			const w = getDefaultWorld();
			const tool = toolTaking(`test {key: ${DOMAIN_DOMAIN_KEY}} {type: ${DOMAIN_PERSISTED_TYPE}}`, w);
			const { key, type } = tool.descriptor.inputSchema.properties;
			if (!key || !type) throw new Error("Expected the key and type parameters");
			expect(key.enum, "the key doesn't list a domain key").toBeUndefined();
			expect(type.enum, "the type doesn't list a type").toBeUndefined();
			expect(validateToolInput([], tool, { key: DOMAIN_NUMBER, type: "Anything" }, w).key).toBe(DOMAIN_NUMBER);
			expect(() => validateToolInput([], tool, { key: "no-such-domain", type: "Anything" }, w)).toThrow(/`show domains` lists them/);
		});

		it("applies domain.coerce() when world is provided", () => {
			const w = getDefaultWorld();
			registerDomains(w, [[{ selectors: ["myDomain"], schema: z.string(), coerce: (proto) => String(proto.value).toUpperCase(), description: "a value upper-cased" }]]);
			const stepper = new (class extends AStepper {
				description = "A step taking a value of a domain that upper-cases it.";
				steps = { doIt: { gwta: "do it with {val: myDomain}", action: async () => OK } };
			})();
			const registry = buildStepRegistry([stepper], w);
			const tool = registry.get(`${stepper.constructor.name}-doIt`);
			if (!tool) throw new Error("Expected tool to be registered");
			const result = validateToolInput([], tool, { val: "hello" }, w);
			expect(result.val).toBe("HELLO");
		});

		it("takes a reference given as an id, an object or JSON text, and refuses a number and text that isn't JSON", () => {
			const w = getDefaultWorld();
			registerDomains(w, [[individualRefDomain("test-ref", "test-target")]]);
			const stepper = new (class extends AStepper {
				description = "A step that revokes a record by its reference.";
				steps = { revoke: { gwta: "revoke {what: test-ref}", action: async () => OK } };
			})();
			const tool = buildStepRegistry([stepper], w).get(`${stepper.constructor.name}-revoke`);
			if (!tool) throw new Error("Expected tool to be registered");
			expect(validateToolInput([], tool, { what: "urn:uuid:1" }, w).what, "an id").toEqual({ id: "urn:uuid:1" });
			expect(validateToolInput([], tool, { what: { id: "urn:uuid:1" } }, w).what, "a reference").toEqual({ id: "urn:uuid:1" });
			expect(validateToolInput([], tool, { what: '{"id":"urn:uuid:1"}' }, w).what, "its JSON text").toEqual({ id: "urn:uuid:1" });
			expect(() => validateToolInput([], tool, { what: 7 }, w), "a number").toThrow(/"what" \(value: 7\): Invalid input: expected object/);
			expect(() => validateToolInput([], tool, { what: '{"id":' }, w), "text that isn't JSON").toThrow(/"what" \(value: .*\): is text that isn't JSON \(.+\): \{"id":/);
		});
	});

	describe("discoverSteps", () => {
		it("returns steps and domains", () => {
			const w = getDefaultWorld();
			registerDomains(w, [[{ selectors: ["color"], schema: z.enum(["red", "green", "blue"]), values: ["red", "green", "blue"], description: "A colour" }]]);
			const stepper = new PlainStepper();
			const discovery = discoverSteps(w, new StepRegistry([stepper], w), EVERY_DEFINITION, RUN_AUTHORITY);
			expect(Array.isArray(discovery.steps)).toBe(true);
			expect(discovery.steps.some((m) => m.method === "PlainStepper-greet")).toBe(true);
			expect(discovery.domains).toBeDefined();
			expect(discovery.domains["color"]).toMatchObject({ description: "A colour", values: ["red", "green", "blue"] });
		});

		it("extracts enum values from a z.enum domain schema when the domain doesn't set values", () => {
			const w = getDefaultWorld();
			registerDomains(w, [[{ selectors: ["size"], schema: z.enum(["small", "medium", "large"]), description: "T-shirt size" }]]);
			const stepper = new PlainStepper();
			const discovery = discoverSteps(w, new StepRegistry([stepper], w), EVERY_DEFINITION, RUN_AUTHORITY);
			expect(discovery.domains["size"]).toMatchObject({ description: "T-shirt size", values: ["small", "medium", "large"] });
		});
	});

	describe("createStepHandler", () => {
		// synth names each tool by the method name the registry uses. Dispatch resolves the step built from the tool by
		// that name.
		const synth = (step: { stepperName: string; stepName: string; description: string }, input: Record<string, unknown>, seqPath: number[] = [0]) =>
			buildFeatureStepForTransport(carrierTool(step.stepperName, step.stepName, step.description, {}), input, seqPath);

		it("states a call a transport carries as the feature line for that call", () => {
			const tool = carrierTool("S", "click", "click( invisible)? {target: page-target}", { target: "page-target" });
			expect(buildFeatureStepForTransport(tool, { target: "Knock" }, [0]).in).toBe('click "Knock"');
		});

		it("returns the action's products unchanged, and dispatchStep adds framework fields such as _seqPath", async () => {
			const stepper = new ProductStepper();
			const handler = createStepHandler("ProductStepper", "getCount", stepper.steps.getCount);
			const result = await handler(synth({ stepperName: "ProductStepper", stepName: "getCount", description: "" }, {}), world);
			expect(result.ok).toBe(true);
			expect(result.products).toMatchObject({ count: 42 });
			// dispatchStep adds `_seqPath`. createStepHandler leaves products unchanged so output schemas stay strict.
			expect(result.products?._seqPath).toBeUndefined();
		});

		it("returns ok for plain step", async () => {
			const stepper = new PlainStepper();
			const handler = createStepHandler("PlainStepper", "greet", stepper.steps.greet);
			const result = await handler(synth({ stepperName: "PlainStepper", stepName: "greet", description: "greet {name}" }, { name: "world" }), world);
			expect(result.ok).toBe(true);
		});

		it("the bare handler doesn't add the seqPath to products, and dispatchStep adds it after validation", async () => {
			const stepper = new ProductStepper();
			const handler = createStepHandler("ProductStepper", "getCount", stepper.steps.getCount);
			const result = await handler(synth({ stepperName: "ProductStepper", stepName: "getCount", description: "" }, {}, [2, 3, 4]), world);
			expect(result.ok).toBe(true);
			expect(result.products?._seqPath).toBeUndefined();
		});

		it("returns errorMessage for failed step", async () => {
			const stepper = new ProductStepper();
			const handler = createStepHandler("ProductStepper", "failStep", stepper.steps.failStep);
			const result = await handler(synth({ stepperName: "ProductStepper", stepName: "failStep", description: "" }, {}), world);
			expect(result.ok).toBe(false);
			expect(result.errorMessage).toBe("intentional failure");
		});

		it("catches thrown errors", async () => {
			const stepper = new ProductStepper();
			const handler = createStepHandler("ProductStepper", "throwStep", stepper.steps.throwStep);
			const result = await handler(synth({ stepperName: "ProductStepper", stepName: "throwStep", description: "" }, {}), world);
			expect(result.ok).toBe(false);
			expect(result.errorMessage, "the message it threw, as a step's refusal").toBe("the step threw: boom");
		});

		it("populates stepValuesMap from input", async () => {
			let capturedFeatureStep: unknown;
			const stepDef = {
				gwta: "say hello to {name}",
				action: (_args: Record<string, unknown>, featureStep: unknown) => {
					capturedFeatureStep = featureStep;
					return OK;
				},
			};
			const handler = createStepHandler("Test", "greet", stepDef as TStepperStep);
			await handler(synth({ stepperName: "Test", stepName: "greet", description: "say hello to {name}" }, { name: "world" }), world);
			const fs = capturedFeatureStep as { action: { stepValuesMap?: Record<string, unknown> } };
			expect(fs.action.stepValuesMap).toBeDefined();
			expect(fs.action.stepValuesMap?.["name"]).toBeDefined();
		});
	});

	describe("dispatchStep", () => {
		it("validates, authorizes, and preserves seqPath", async () => {
			const stepper = new (class extends AStepper {
				description = "A protected step that echoes a message.";
				steps = {
					protectedEcho: {
						gwta: "protected echo {message}",
						capability: "Remote:invoke",
						productsDomain: TEST_DOMAIN.echoed,
						action: async ({ message }: { message: string }) => actionOKWithProducts({ echoed: message }),
					},
				};
			})();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get(`${stepper.constructor.name}-protectedEcho`);
			if (!tool) throw new Error("Expected protected tool to be registered");

			const validatedParams = validateToolInput([0, 7], tool, { message: "hello" }, world);
			const featureStep = buildFeatureStepForTransport(tool, validatedParams, [0, 7]);
			const result = await dispatchStep({ registry, world, steppers, grantedCapability: ["Remote:invoke"] }, featureStep);

			expect(result.ok).toBe(true);
			expect(result.products).toMatchObject({ echoed: "hello", _seqPath: [0, 7] });
		});

		it("runs a step dispatched inside an invoked call under the action its caller holds for it, and refuses one the caller doesn't hold", async () => {
			const INVOKED = "Outer:run";
			const NESTED = "Inner:guarded";
			const nested: { registry?: StepRegistry } = {};
			const stepper = new (class extends AStepper {
				description = "An outer step that dispatches a guarded step inside its own call.";
				steps = {
					guarded: { gwta: "guarded", capability: NESTED, action: () => OK },
					outer: {
						gwta: "outer",
						capability: INVOKED,
						action: async () => {
							const registry = nested.registry;
							if (!registry) throw new Error("the registry isn't built");
							const inner = itemAt(
								[registry.get(`${this.constructor.name}-guarded`)].filter((tool) => tool !== undefined),
								0,
							);
							const result = await dispatchStep({ registry, world, steppers: [this] }, buildFeatureStepForTransport(inner, {}, [0, 9, 1]));
							return result.ok ? OK : actionNotOK(String(result.errorMessage));
						},
					},
				};
			})();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			nested.registry = registry;
			const outer = registry.get(`${stepper.constructor.name}-outer`) as StepTool;
			const invoke = (held: string[]) => dispatchStep({ registry, world, steppers, grantedCapability: [INVOKED], held }, buildFeatureStepForTransport(outer, {}, [0, 9]));
			expect((await invoke([INVOKED, NESTED])).ok, "the caller's chain holds the nested step's action").toBe(true);
			const refused = await invoke([INVOKED]);
			expect(refused.ok).toBe(false);
			expect(refused.errorMessage).toContain(`capability ${NESTED} required`);
		});

		it("validates an empty value that a caller writes against its domain, since a fact doesn't stand for a written value", async () => {
			const FILTER = "empty-means-every";
			registerDomains(world, [[{ selectors: [FILTER], schema: z.string(), description: "a filter whose empty value matches everything" }]]);
			const stepper = new (class extends AStepper {
				description = "A step that filters by a value its domain validates.";
				steps = {
					filters: {
						gwta: `filter by {filter: ${FILTER}}`,
						productsDomain: TEST_DOMAIN.echoed,
						action: async ({ filter }: { filter: string }) => actionOKWithProducts({ echoed: filter }),
					},
				};
			})();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get(`${stepper.constructor.name}-filters`) as StepTool;
			const result = await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, buildFeatureStepForTransport(tool, { filter: "" }, [0, 8]));
			expect(result.errorMessage).toBeUndefined();
			expect(result.products).toMatchObject({ echoed: "" });
		});

		it("refuses products whose domain a step doesn't name, and checks what a step passes on against its statement's domain", async () => {
			const said = async (line: string) => {
				const res = await testWithWorld(getDefaultWorld(), line, [PassesOn]);
				return { ok: res.ok, error: res.failure?.error.message, products: res.featureResults?.[0]?.stepResults.find((r) => r.in === line)?.products };
			};
			expect((await said(COUNT_UNNAMED)).error, "a step returning products without a domain").toMatch(/returned products and doesn't name a domain/);
			expect(await said(`${ANSWER_AS} ${COUNT}`), "a step returning its statement's products").toMatchObject({ ok: true, products: { count: 1 } });
			expect(await said(`${ANSWER_AS} ${ANSWER_AS} ${COUNT}`), "through a step that also returns its statement's products").toMatchObject({ ok: true, products: { count: 1 } });
			expect((await said(`${PASS_ON} ${COUNT}`)).error, "a step returning its statement's products without a domain").toMatch(/returned products and doesn't name a domain/);
			expect((await said(`${ANSWER_WRONGLY} ${COUNT}`)).error, "products not in its statement's domain").toMatch(/passing on PassesOn\.counts products failed schema validation/);
			const naming = new (class extends AStepper {
				description = "A step that passes on the products of a parameter that isn't a statement.";
				steps = { names: { gwta: "name {n: number}", productsOf: "n", action: async () => OK } };
			})();
			expect(() => new StepRegistry([naming], world), "a step naming a parameter that doesn't take a statement").toThrow(
				/productsOf names \{n\}, which isn't a statement its phrase takes/,
			);
		});

		it("pairs a record id with the parameter naming its type, and takes the id however a line gives it", async () => {
			const reads = new (class extends AStepper {
				description = "A step that reads a record by its type and id.";
				steps = {
					readsRecord: {
						gwta: `read {label: ${DOMAIN_PERSISTED_TYPE}} {id: ${DOMAIN_RECORD_ID}}`,
						recordIds: { id: "label" },
						productsDomain: TEST_DOMAIN.echoed,
						action: async ({ id }: { id: string }) => actionOKWithProducts({ echoed: id }),
					},
				};
			})();
			const steppers = [reads];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get(`${reads.constructor.name}-readsRecord`) as StepTool;
			const read = (id: unknown, path: number[]) =>
				dispatchStep(
					{ registry, world, steppers, grantedCapability: RUN_AUTHORITY },
					buildFeatureStepForTransport(tool, validateToolInput(path, tool, { label: "Letter", id }, world), path),
				);
			for (const [given, path] of [
				["e1", [0, 31, 1]],
				[{ id: "e1" }, [0, 31, 2]],
				['{"id": "e1", "subject": "hi"}', [0, 31, 3]],
			] as const)
				expect((await read(given, [...path])).products, `the id from ${JSON.stringify(given)}`).toMatchObject({ echoed: "e1" });
			const declaring = (step: Partial<TStepperStep>) =>
				new StepRegistry(
					[
						new (class extends AStepper {
							description = "A step each test declares with what it reads.";
							steps = { reads: { action: async () => OK, ...step } as TStepperStep };
						})(),
					],
					world,
				);
			expect(() => declaring({ gwta: `read {label: ${DOMAIN_PERSISTED_TYPE}} {id: ${DOMAIN_RECORD_ID}}` }), "a record id that isn't paired with a parameter").toThrow(
				/\{id\} is a record-id that its recordIds doesn't pair with a type/,
			);
			expect(() => declaring({ gwta: `read {label: string} {id: ${DOMAIN_RECORD_ID}}`, recordIds: { id: "label" } }), "paired with a parameter that doesn't name a type").toThrow(
				/recordIds pairs \{id\} with \{label\}, which doesn't name a type/,
			);
			expect(
				() => declaring({ gwta: `write {label: string} {data: ${DOMAIN_JSON}}`, recordData: { data: "label" } }),
				"fields paired with a parameter that doesn't name a type",
			).toThrow(/recordData pairs \{data\} with \{label\}, which doesn't name a type/);
			expect(
				() => declaring({ gwta: `write {label: ${DOMAIN_PERSISTED_TYPE}} {data: ${DOMAIN_JSON}}`, recordData: { fields: "label" } }),
				"a parameter its phrase doesn't take",
			).toThrow(/recordData names \{fields\}, which its phrase doesn't take/);
		});

		it("logs each call under its own step while two steps run at once", async () => {
			let started = 0;
			let release = () => undefined as void;
			const released = new Promise<void>((resolve) => (release = resolve));
			const stepper = new (class extends AStepper {
				description = "A step that logs its argument once two calls of it have started.";
				steps = {
					sayOnceBothStarted: {
						gwta: "say {what} once both have started",
						action: async ({ what }: { what: string }) => {
							if (++started === 2) release();
							await released;
							world.eventLogger.info(what);
							return OK;
						},
					},
				};
			})();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get(`${stepper.constructor.name}-sayOnceBothStarted`);
			if (!tool) throw new Error("Expected the step to be registered");
			const logged: Array<{ id: string; message: string }> = [];
			world.eventLogger.subscribe((event) => {
				if (event.kind === "log") logged.push({ id: event.id, message: event.message });
			});
			const say = (what: string, path: number[]) =>
				dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, buildFeatureStepForTransport(tool, validateToolInput(path, tool, { what }, world), path));
			await Promise.all([say("first", [0, 8, 1]), say("second", [0, 8, 2])]);
			expect(logged.find((log) => log.message === "first")?.id, "the first call's log names the first step").toMatch(/^0\.8\.1\.log\./);
			expect(logged.find((log) => log.message === "second")?.id, "and the second's the second").toMatch(/^0\.8\.2\.log\./);
		});

		it("denies missing capability", async () => {
			const stepper = new CapabilityStepper();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("CapabilityStepper-protectedPing");
			if (!tool) throw new Error("Expected protected tool to be registered");

			const featureStep = buildFeatureStepForTransport(tool, {}, [0, 1]);
			await expect(dispatchStep({ registry, world, steppers }, featureStep)).rejects.toThrow(/capability CapabilityStepper:protected required/);
		});

		describe("what the caller holds", () => {
			const NOTICE_LABEL = "HeldNotice";
			const NOTICE_ID = "notice-1";
			const NOTICE_DOMAIN: TDomainDefinition = {
				selectors: ["held-notice"],
				schema: PersistedVertexSchema.extend({ id: z.string() }),
				description: "A notice a caller writes",
				topology: { persistedAs: NOTICE_LABEL, id: "id", accessLevel: Access.opened, properties: { id: LinkRelations.IDENTIFIER.rel } },
			};
			class Held extends AStepper {
				description = "A step that reads at the caller's ceiling, a step that reads records, a step that writes a record, and a read step at private.";
				steps = {
					writesNotice: {
						gwta: "write a notice",
						productsDomain: TEST_DOMAIN.echoed,
						action: async () => actionOKWithProducts({ echoed: await world.shared.getStore().upsertIndividual(NOTICE_LABEL, { id: NOTICE_ID }) }),
					},
					readsAtCeiling: { gwta: "read at the ceiling", productsDomain: TEST_DOMAIN.readAt, action: async () => actionOKWithProducts({ at: readingAt() ?? "unbounded" }) },
					readsRecords: {
						gwta: "count the records",
						productsDomain: TEST_DOMAIN.count,
						action: async () => actionOKWithProducts({ count: (await world.shared.getStore().all()).length }),
					},
					describesItself: { gwta: "describe this", read: true, readsAt: Access.private, action: async () => OK },
				};
			}
			const held = () => {
				const steppers = [new Held()];
				const registry = new StepRegistry(steppers, world);
				const call = (name: string, grantedCapability: string[], path: number[]) => {
					const tool = registry.get(`Held-${name}`);
					if (!tool) throw new Error(`Expected Held-${name} to be registered`);
					return dispatchStep({ registry, world, steppers, grantedCapability }, buildFeatureStepForTransport(tool, {}, path));
				};
				return {
					call,
					fieldOf: (path: number[], field: string) => world.shared.getStore().get(formatRecordName({ execution: executionOf(world.tag), path }), field, SEQ_PATH_LABEL),
				};
			};

			it("refuses a step that doesn't declare a capability to a caller not holding its name, and a read to a caller that doesn't hold a read", async () => {
				const { call } = held();
				await expect(call("readsAtCeiling", [], [0, 20, 1])).rejects.toThrow(/capability Held:readsAtCeiling required/);
				await expect(call("describesItself", [], [0, 20, 2]), "a read at private is refused to a caller that doesn't hold Read:private").rejects.toThrow(
					/capability Read:private required/,
				);
				expect((await call("describesItself", ["Read:private"], [0, 20, 3])).ok, "a broader read allows it").toBe(true);
			});

			it("bounds what a step reads by the broadest read its caller holds", async () => {
				const { call } = held();
				expect((await call("readsAtCeiling", ["Held:readsAtCeiling", "Read:public"], [0, 21, 1])).products?.at).toBe("public");
				expect((await call("readsAtCeiling", ["Held:readsAtCeiling", "Read:opened"], [0, 21, 2])).products?.at).toBe("opened");
				expect((await call("readsAtCeiling", RUN_AUTHORITY, [0, 21, 3])).products?.at, "actuality reads at the broadest level it holds").toBe("private");
				expect((await runReadingAt("public", () => call("readsAtCeiling", RUN_AUTHORITY, [0, 21, 4]))).products?.at, "and never above a ceiling already in force").toBe("public");
			});

			it("refuses each read of records to a caller that doesn't hold a read action, naming the read it lacks", async () => {
				const { call } = held();
				const ceiling = await call("readsAtCeiling", ["Held:readsAtCeiling"], [0, 23, 1]);
				expect(ceiling.ok ? ceiling.products : ceiling.errorMessage, "the step's read of its ceiling is refused").toBe(`the step threw: ${WITHOUT_READ_REFUSAL}`);
				const records = await call("readsRecords", ["Held:readsRecords"], [0, 23, 2]);
				expect(records.ok ? records.products : records.errorMessage, "and so is its read of the store's records").toBe(`the step threw: ${WITHOUT_READ_REFUSAL}`);
				expect((await call("readsRecords", ["Held:readsRecords", "Read:public"], [0, 23, 3])).ok, "a caller that holds a read reads").toBe(true);
			});

			it("writes a record for a caller that holds only the write's action, at the level its type declares, and returns only the written record's id", async () => {
				registerDomains(world, [[NOTICE_DOMAIN]]);
				const { call } = held();
				const written = await call("writesNotice", ["Held:writesNotice"], [0, 24, 1]);
				expect(written.ok, written.errorMessage).toBe(true);
				expect(written.products?.echoed, "the write returns the id of the record it wrote").toBe(NOTICE_ID);
				const stored = await world.shared.getStore().query({ subject: NOTICE_ID, namedGraph: NOTICE_LABEL });
				expect(new Set(stored.map(({ accessLevel }) => accessLevel)), "at the level its type declares").toEqual(new Set([Access.opened]));
				const read = await call("readsRecords", ["Held:readsRecords"], [0, 24, 2]);
				expect(read.ok ? read.products : read.errorMessage, "and the same caller's read is refused").toBe(`the step threw: ${WITHOUT_READ_REFUSAL}`);
			});

			it("records what a caller's step required and held and who proved it, and doesn't record authority for actuality's own", async () => {
				const { call, fieldOf } = held();
				await runActingAs("did:example:alice", () => call("readsAtCeiling", ["Held:readsAtCeiling"], [0, 22, 1]));
				expect(await fieldOf([0, 22, 1], SEQ_PATH_FIELD.capabilityAction)).toBe("Held:readsAtCeiling");
				expect(await fieldOf([0, 22, 1], SEQ_PATH_FIELD.allowedAction)).toBe("Held:readsAtCeiling");
				expect(await fieldOf([0, 22, 1], LinkRelations.PERFORMED_BY.rel)).toBe("did:example:alice");
				await call("readsAtCeiling", RUN_AUTHORITY, [0, 22, 2]);
				expect(await fieldOf([0, 22, 2], SEQ_PATH_FIELD.capabilityAction), "actuality holds every capability, and its step doesn't record one").toBeUndefined();
				expect(await fieldOf([0, 22, 2], SEQ_PATH_FIELD.allowedAction)).toBeUndefined();
			});
		});

		it("returns the result of a read over a transport without recording the read, and records a read that a feature states in its own body", async () => {
			const stepper = new (class extends AStepper {
				description = "A read that counts.";
				steps = { howMany: { gwta: "how many", read: true, readsAt: Access.private, productsDomain: TEST_DOMAIN.count, action: async () => actionOKWithProducts({ count: 3 }) } };
			})();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get(`${stepper.constructor.name}-howMany`);
			if (!tool) throw new Error("Expected the read to be registered");
			const store = world.shared.getStore();
			const recordOf = (path: number[]) => store.query({ subject: formatRecordName({ execution: executionOf(world.tag), path }), namedGraph: SEQ_PATH_LABEL });

			// A page reads actuality over a transport. Every transport marks its step programmatic.
			const overATransport = buildFeatureStepForTransport(tool, {}, [0, 9, 1]);
			expect(overATransport.programmatic, "a transport marks the step programmatic").toBe(true);
			let kept = world.runtime.stepResults?.length ?? 0;
			const answered = await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, overATransport);
			expect(answered.ok).toBe(true);
			expect(answered.products, "the read returns its products").toMatchObject({ count: 3 });
			expect(await recordOf([0, 9, 1]), "a read over a transport doesn't leave a record").toEqual([]);
			expect(await countFact(world, [0, 9, 1]), "and doesn't leave a fact of what it returned").toBeUndefined();
			expect(world.runtime.stepResults?.length ?? 0, "the process doesn't keep a step result for it").toBe(kept);

			// A read beneath a step the feature states is the feature reading through a combinator. `set x from <a read>` takes
			// its result from the read's result, so the read is a step of actuality like the line that states it.
			const beneathAStep = buildFeatureStepForTransport(tool, {}, [0, 9, 2]);
			beneathAStep.programmatic = undefined;
			beneathAStep.isSubStep = true;
			kept = world.runtime.stepResults?.length ?? 0;
			await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, beneathAStep);
			expect((await recordOf([0, 9, 2])).length, "a read the feature stated through a combinator is actuality reading").toBeGreaterThan(0);
			expect(world.runtime.stepResults?.length ?? 0, "and actuality keeps its result").toBe(kept + 1);

			// The same read stated in a feature's own body is also a step of actuality.
			const inTheFeature = buildFeatureStepForTransport(tool, {}, [0, 9, 3]);
			inTheFeature.programmatic = undefined;
			kept = world.runtime.stepResults?.length ?? 0;
			const run = await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, inTheFeature);
			expect(run.ok).toBe(true);
			expect((await recordOf([0, 9, 3])).length, "a read a feature states is a step of actuality").toBeGreaterThan(0);
			expect(await countFact(world, [0, 9, 3]), "whose products are a fact of actuality").toMatchObject({ count: 3 });
			expect(world.runtime.stepResults?.length ?? 0, "and is kept with actuality's other steps").toBe(kept + 1);
		});

		it("holds a fact of what a step retains, so actuality doesn't hold the products of a step that doesn't retain them", async () => {
			const stepper = new (class extends AStepper {
				description = "Steps whose products are retained and not retained.";
				steps = {
					counted: { gwta: "counted", productsDomain: TEST_DOMAIN.count, action: async () => actionOKWithProducts({ count: 4 }) },
					notRetained: { gwta: "not retained", productsDomain: TEST_DOMAIN.count, retainProducts: false, action: async () => actionOKWithProducts({ count: 5 }) },
				};
			})();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const run = async (method: string, path: number[]) => {
				const tool = registry.get(`${stepper.constructor.name}-${method}`);
				if (!tool) throw new Error(`Expected ${method} to be registered`);
				const featureStep = buildFeatureStepForTransport(tool, {}, path);
				featureStep.programmatic = undefined;
				expect((await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, featureStep)).ok).toBe(true);
			};
			await run("counted", [0, 9, 4]);
			await run("notRetained", [0, 9, 5]);
			expect(await countFact(world, [0, 9, 4])).toMatchObject({ count: 4 });
			expect(await countFact(world, [0, 9, 5])).toBeUndefined();
		});

		it("records a step its caller stopped as stopped in its record and end event, and a step that fails on its own as failed", async () => {
			const stepper = new ProductStepper();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("ProductStepper-failStep");
			if (!tool) throw new Error("Expected ProductStepper-failStep to be registered");
			const ended: string[] = [];
			world.eventLogger.subscribe((event) => {
				if (event.kind === "lifecycle" && event.type === "step" && event.stage === "end") ended.push(String(event.status));
			});
			const statusOf = (path: number[]) => world.shared.getStore().get(formatRecordName({ execution: executionOf(world.tag), path }), SEQ_PATH_FIELD.actionStatus, SEQ_PATH_LABEL);
			const stop = new AbortController();
			stop.abort();
			await streamContext.run(
				streamOver(() => undefined, stop),
				() => dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, buildFeatureStepForTransport(tool, {}, [0, 3, 6])),
			);
			await streamContext.run(
				streamOver(() => undefined, new AbortController()),
				() => dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, buildFeatureStepForTransport(tool, {}, [0, 3, 7])),
			);
			expect(await statusOf([0, 3, 6]), "the stopped step's record").toBe(RECORDED_STATUS.stopped);
			expect(await statusOf([0, 3, 7]), "a step that failed on its own").toBe(RECORDED_STATUS.failed);
			expect(ended).toEqual(["stopped", "failed"]);
		});

		it("emits SeqPath quads for a passing step", async () => {
			const stepper = new ProductStepper();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("ProductStepper-getCount");
			if (!tool) throw new Error("Expected ProductStepper-getCount to be registered");

			const featureStep = buildFeatureStepForTransport(tool, {}, [0, 3, 5]);
			const result = await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, featureStep);
			expect(result.ok).toBe(true);

			const store = world.shared.getStore();
			const id = formatRecordName({ execution: executionOf(world.tag), path: [0, 3, 5] });
			const quads = await store.query({ subject: id, namedGraph: SEQ_PATH_LABEL });
			const byPredicate = Object.fromEntries(quads.map((q) => [q.predicate, q.object]));
			expect(byPredicate[SEQ_PATH_FIELD.actionStatus]).toBe(RECORDED_STATUS.completed);
			expect(byPredicate[SEQ_PATH_FIELD.generatedAtTime]).toEqual(expect.any(String));
			expect(byPredicate[SEQ_PATH_FIELD.endedAtTime]).toEqual(expect.any(String));
			expect(byPredicate[LinkRelations.PART_OF.rel], "a step is part of its parent step of the same execution").toBe(
				formatRecordName({ execution: executionOf(world.tag), path: [0, 3] }),
			);
			expect(byPredicate[SEQ_PATH_FIELD.stepText]).toEqual(expect.any(String));
			// An authoritative step states its mode, so a query for the steps that weren't speculative matches it.
			expect(byPredicate[SEQ_PATH_FIELD.mode]).toBe("authoritative");
		});

		it("records the mode of each step, so a reader can distinguish speculative and authoritative steps", async () => {
			const stepper = new ProductStepper();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("ProductStepper-getCount");
			if (!tool) throw new Error("Expected ProductStepper-getCount to be registered");

			const featureStep = buildFeatureStepForTransport(tool, {}, [0, 4, 1]);
			featureStep.intent = { mode: "speculative" };
			await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, featureStep);

			const store = world.shared.getStore();
			const mode = await store.get(formatRecordName({ execution: executionOf(world.tag), path: [0, 4, 1] }), SEQ_PATH_FIELD.mode, SEQ_PATH_LABEL);
			expect(mode, "a speculative step's record states its mode, since its failure isn't a failure of actuality").toBe("speculative");
		});

		it("emits SeqPath quads with status=failed for a failing step", async () => {
			const stepper = new ProductStepper();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("ProductStepper-failStep");
			if (!tool) throw new Error("Expected ProductStepper-failStep to be registered");

			const featureStep = buildFeatureStepForTransport(tool, {}, [0, 9]);
			const result = await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, featureStep);
			expect(result.ok).toBe(false);

			const store = world.shared.getStore();
			const status = await store.get(formatRecordName({ execution: executionOf(world.tag), path: [0, 9] }), SEQ_PATH_FIELD.actionStatus, SEQ_PATH_LABEL);
			expect(status).toBe(RECORDED_STATUS.failed);
		});

		it("writes a step's record once at its start and once at its end, and doesn't read it (PF26)", async () => {
			const steppers = [new ProductStepper()];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("ProductStepper-failStep");
			if (!tool) throw new Error("Expected ProductStepper-failStep to be registered");
			const store = world.shared.getStore();
			const stepWrites: string[] = [];
			const upsert = store.upsertIndividual.bind(store);
			const set = store.set.bind(store);
			const get = store.get.bind(store);
			store.upsertIndividual = (label, data) => (label === SEQ_PATH_LABEL && stepWrites.push("upsert"), upsert(label, data));
			store.set = (subject, predicate, object, namedGraph, properties) => (
				namedGraph === SEQ_PATH_LABEL && stepWrites.push("set"), set(subject, predicate, object, namedGraph, properties)
			);
			store.get = (subject, predicate, namedGraph) => (namedGraph === SEQ_PATH_LABEL && stepWrites.push("get"), get(subject, predicate, namedGraph));
			await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, buildFeatureStepForTransport(tool, {}, [0, 9, 2]));
			expect(stepWrites).toEqual(["upsert", "upsert"]);
			const record = (await store.query({ subject: formatRecordName({ execution: executionOf(world.tag), path: [0, 9, 2] }), namedGraph: SEQ_PATH_LABEL })).map((q) => q.predicate);
			expect(record, "the end's write holds the start's fields with how it ended").toEqual(
				expect.arrayContaining([SEQ_PATH_FIELD.stepText, SEQ_PATH_FIELD.generatedAtTime, SEQ_PATH_FIELD.endedAtTime, SEQ_PATH_FIELD.error]),
			);
		});

		it("moves the actuality machine with the step's start and end, and counts its failure", async () => {
			const steppers = [new ProductStepper()];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("ProductStepper-failStep");
			if (!tool) throw new Error("Expected ProductStepper-failStep to be registered");
			const before = world.runtime.actuality.state.get();
			await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, buildFeatureStepForTransport(tool, {}, [0, 9, 3]));
			const after = world.runtime.actuality.state.get();
			expect(after.steps).toBe(before.steps + 1);
			expect(after.open.has("0.9.3"), "the step's end closed it").toBe(false);
			expect(after.failures.at(-1)).toMatchObject({ id: "0.9.3", message: "intentional failure" });
		});
	});

	describe("domains of inputs and products", () => {
		const TestEmailSchema = z.object({ id: z.string(), subject: z.string() });

		class DomainEchoStepper extends AStepper {
			description = "A step that produces a test letter, and steps that declare domains wrongly.";
			steps = {
				produceEmail: { gwta: "produce an letter", productsDomain: "test-letter", action: () => actionOKWithProducts({ id: "e1", subject: "hi" }) },
				unregisteredInput: { gwta: "consume {who: no-such-domain}", action: () => OK },
				dualOutput: { gwta: "produce two outputs", productsDomain: "test-letter", productsDomains: { x: "string" }, action: () => actionOKWithProducts({ id: "e", subject: "s" }) },
				unknownDomain: { gwta: "produce a ghost", productsDomain: "not-registered", action: () => actionOKWithProducts({}) },
			};
		}

		beforeEach(() => {
			registerDomains(world, [[{ selectors: ["test-letter"], schema: TestEmailSchema, description: "Test letter" }]]);
		});

		it("records the view a step showed by its declared name", async () => {
			registerDomains(world, [[{ selectors: ["test-view"], schema: z.object({}), description: "A view", ui: { component: "test-view-element" } }]]);
			class ShowsAView extends AStepper {
				description = "A step that shows a view.";
				steps = { showIt: { gwta: "show the view", productsDomain: "test-view", action: () => actionOKWithProducts({}) } };
			}
			const steppers = [new ShowsAView()];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("ShowsAView-showIt");
			if (!tool) throw new Error("Expected ShowsAView-showIt to be registered");
			const featureStep = buildFeatureStepForTransport(tool, {}, [0, 7, 1]);
			await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, featureStep);
			const showed = await world.shared.getStore().get(formatRecordName({ execution: executionOf(world.tag), path: [0, 7, 1] }), SEQ_PATH_FIELD.showed, SEQ_PATH_LABEL);
			expect(showed, "the record names the domain of the view the step showed, and a document embeds the view by that name").toBe("test-view");
		});

		it("registers a step with productsDomain referencing a known domain", () => {
			class JustProduce extends AStepper {
				description = "A step that produces a test letter.";
				steps = { produceEmail: new DomainEchoStepper().steps.produceEmail };
			}
			const registry = buildStepRegistry([new JustProduce()], world);
			const tool = registry.get("JustProduce-produceEmail");
			expect(tool?.descriptor.outputSchema).toBeDefined();
		});

		it("refuses a parameter whose domain the steppers don't register, naming the step, the parameter and the domain", () => {
			class JustUnregistered extends AStepper {
				description = "A step taking a domain the steppers don't register.";
				steps = { unregisteredInput: new DomainEchoStepper().steps.unregisteredInput };
			}
			expect(() => buildStepRegistry([new JustUnregistered()], world)).toThrow(
				`step JustUnregistered.unregisteredInput: {who} names the domain "no-such-domain", which the loaded steppers don't register.`,
			);
		});

		it("rejects mutually exclusive productsDomain and productsDomains", () => {
			class JustDual extends AStepper {
				description = "A step declaring both productsDomain and productsDomains.";
				steps = { dualOutput: new DomainEchoStepper().steps.dualOutput };
			}
			expect(() => buildStepRegistry([new JustDual()], world)).toThrow(/only one of/);
		});

		it("rejects productsDomain referencing an unregistered domain", () => {
			class JustUnknown extends AStepper {
				description = "A step producing a domain the steppers don't register.";
				steps = { unknownDomain: new DomainEchoStepper().steps.unknownDomain };
			}
			expect(() => buildStepRegistry([new JustUnknown()], world)).toThrow(/productsDomain names the domain "[^"]+", which the loaded steppers don't register/);
		});
	});

	describe("_links derivation, H1 next-action affordances from paramDomains", () => {
		const PermitSchema = z.object({ id: z.string(), subject: z.string() }).describe("A signed claim about a subject.");
		const PermitRefSchema = z.object({ id: z.string() }).describe("Reference to a permit by id.");

		class IssuerStepper extends AStepper {
			description = "Steps that issue, revoke and suspend a demo permit.";
			steps = {
				issueDemoPermit: { gwta: "issue demo permit", productsDomain: "demo-permit", action: () => actionOKWithProducts({ id: "permit-1", subject: "did:example:alice" }) },
				revokeDemo: { gwta: "revoke {permit: demo-permit}", productsDomain: "demo-permit", action: () => actionOKWithProducts({ id: "permit-1", subject: "did:example:alice" }) },
				suspendDemo: { gwta: "suspend {permit: demo-permit}", productsDomain: "demo-permit", action: () => actionOKWithProducts({ id: "permit-1", subject: "did:example:alice" }) },
				unrelatedStep: { gwta: "do unrelated thing {name: string}", action: () => OK },
			};
		}

		beforeEach(() => {
			registerDomains(world, [
				[
					{ selectors: ["demo-permit"], schema: PermitSchema, description: "Verifiable permit vertex" },
					{ selectors: ["demo-permit-ref"], schema: PermitRefSchema, description: "Permit reference" },
				],
			]);
		});

		it("populates `_links` with every step whose param domain matches the product's productsDomain", async () => {
			const stepper = new IssuerStepper();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("IssuerStepper-issueDemoPermit");
			if (!tool) throw new Error("Expected IssuerStepper-issueDemoPermit to be registered");

			const featureStep = buildFeatureStepForTransport(tool, {}, [0, 1]);
			const result = await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, featureStep);
			expect(result.ok).toBe(true);

			const products = result.products as Record<string, unknown>;
			const links = products._links as Record<string, { method: string; params?: Record<string, unknown> }> | undefined;
			expect(links).toBeDefined();
			// Two steps take demo-permit as input: revoke and suspend. The issue step doesn't take demo-permit as input, so `_links` doesn't list it.
			expect(Object.keys(links ?? {}).sort()).toEqual(["revokeDemo", "suspendDemo"]);
			// The method is the full dispatch address. The params skeleton holds the product's `id`.
			expect(links?.revokeDemo).toEqual({ method: "IssuerStepper-revokeDemo", params: { permit: { id: "permit-1" } } });
			expect(links?.suspendDemo).toEqual({ method: "IssuerStepper-suspendDemo", params: { permit: { id: "permit-1" } } });
		});

		it("doesn't emit `_links` when the other steps don't accept this product's domain", async () => {
			class IsolatedStepper extends AStepper {
				description = "A step whose product the other steps don't take.";
				steps = { produce: { gwta: "produce a lone product", productsDomain: "lone-domain", action: () => actionOKWithProducts({ id: "x" }) } };
			}
			registerDomains(world, [[{ selectors: ["lone-domain"], schema: z.object({ id: z.string() }), description: "Lone" }]]);
			const stepper = new IsolatedStepper();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("IsolatedStepper-produce");
			if (!tool) throw new Error("Expected IsolatedStepper-produce to be registered");

			const featureStep = buildFeatureStepForTransport(tool, {}, [0, 1]);
			const result = await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, featureStep);
			expect(result.ok).toBe(true);

			const products = result.products as Record<string, unknown>;
			// The other steps don't take lone-domain. `_links` is absent rather than an empty object, so a consumer can treat a present `_links` as a non-empty Record.
			expect(products._links).toBeUndefined();
		});

		it("follows topology.ranges.id from a ref domain to the persisted domain, so a `permit-vertex` product links `revoke {permit: permit-ref}`", async () => {
			// A step takes a ref domain whose schema is `{id}` and whose topology.ranges.id names the persisted domain a step produces. The link derivation follows that range. individualRefDomain declares this range on the ref domain that a step takes to name a record by reference.
			class VertexRefStepper extends AStepper {
				description = "Steps that produce a permit vertex and revoke it by reference.";
				steps = {
					producePermit: { gwta: "produce a permit", productsDomain: "permit-vertex", action: () => actionOKWithProducts({ id: "permit-1" }) },
					revokePermit: { gwta: "revoke {permit: permit-ref}", productsDomain: "permit-revocation", action: () => actionOKWithProducts({ revoked: true }) },
				};
			}
			registerDomains(world, [
				[
					{ selectors: ["permit-vertex"], schema: z.object({ id: z.string() }), description: "Permit vertex" },
					{ selectors: ["permit-ref"], schema: z.object({ id: z.string() }), description: "Reference to a permit by id", topology: { ranges: { id: "permit-vertex" } } },
					{ selectors: ["permit-revocation"], schema: z.object({ revoked: z.boolean() }), description: "Revocation outcome" },
				],
			]);
			const stepper = new VertexRefStepper();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("VertexRefStepper-producePermit");
			if (!tool) throw new Error("Expected VertexRefStepper-producePermit to be registered");

			const featureStep = buildFeatureStepForTransport(tool, {}, [0, 1]);
			const result = await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, featureStep);
			expect(result.ok).toBe(true);

			const products = result.products as Record<string, unknown>;
			const links = products._links as Record<string, { method: string; params?: Record<string, unknown> }> | undefined;
			expect(links).toBeDefined();
			// revokePermit takes `permit-ref`, and the topology.ranges.id of `permit-ref` is "permit-vertex". The derivation follows that range and links revokePermit with the product's id as the ref's `{id}`.
			expect(links?.revokePermit).toEqual({ method: "VertexRefStepper-revokePermit", params: { permit: { id: "permit-1" } } });
		});

		it("omits params skeleton when the product doesn't have an `id`: the consumer fills params from the step's shown schema", async () => {
			class IdlessStepper extends AStepper {
				description = "Steps that produce and consume a product without an id.";
				steps = {
					produce: { gwta: "produce an idless thing", productsDomain: "idless", action: () => actionOKWithProducts({ name: "thing" }) },
					consume: { gwta: "consume {what: idless}", action: () => OK },
				};
			}
			registerDomains(world, [[{ selectors: ["idless"], schema: z.object({ name: z.string() }), description: "Idless" }]]);
			const stepper = new IdlessStepper();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("IdlessStepper-produce");
			if (!tool) throw new Error("Expected IdlessStepper-produce to be registered");

			const featureStep = buildFeatureStepForTransport(tool, {}, [0, 1]);
			const result = await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, featureStep);
			expect(result.ok).toBe(true);

			const products = result.products as Record<string, unknown>;
			const links = products._links as Record<string, { method: string; params?: Record<string, unknown> }> | undefined;
			expect(links).toBeDefined();
			expect(links?.consume).toEqual({ method: "IdlessStepper-consume" });
		});
	});
});

describe("retainedProducts", () => {
	const p = { _component: "shu-thread-column", id: "x", rows: [1, 2, 3] };
	it("keeps all when absent or true", () => {
		expect(retainedProducts(p, undefined)).toBe(p);
		expect(retainedProducts(p, true)).toBe(p);
	});
	it("doesn't keep a product when false", () => {
		expect(retainedProducts(p, false)).toBeUndefined();
	});
	it("keeps the subset the filter returns", () => {
		const keepDescriptor = (x: Record<string, unknown>) => ({ _component: x._component, id: x.id });
		expect(retainedProducts(p, keepDescriptor)).toEqual({ _component: "shu-thread-column", id: "x" });
	});
	it("doesn't keep a product when the filter returns undefined or the step doesn't return products", () => {
		expect(retainedProducts(p, () => undefined)).toBeUndefined();
		expect(retainedProducts(undefined, (x) => x)).toBeUndefined();
	});
});
