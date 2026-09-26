import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";

import { dispatchStep, retainedProducts } from "./step-dispatch.js";
import {
	buildStepRegistry,
	stepMethodName,
	createStepHandler,
	discoverSteps,
	buildFeatureStepForTransport,
	authorizeToolCapability,
	StepRegistry,
	type StepTool,
} from "./step-registry.js";
import { validateToolInput } from "./tool-validation.js";
import { EVERY_DEFINITION } from "./step-discovery.js";
import { AStepper, type IHasCycles, type TFeatureStep, type TStepperStep } from "./astepper.js";
import { OK } from "../schema/protocol.js";
import { FlowRunner } from "./core/flow-runner.js";
import { actionOKWithProducts, actionNotOK } from "./util/index.js";
import { getDefaultWorld, testWithWorld } from "./test/lib.js";
import { TEST_DOMAIN, declaresTestDomains, testDomainDefinitions } from "./test/test-domains.js";
import { DOMAIN_DOMAIN_KEY, DOMAIN_NUMBER, DOMAIN_RECORD_ID, DOMAIN_STRING, individualRefDomain, registerDomains } from "./domains.js";
import type { TWorld } from "./world.js";
import { Access, DOMAIN_PERSISTED_TYPE, LinkRelations, SEQ_PATH_LABEL, SEQ_PATH_STATUS } from "./resources.js";
import { SEQ_PATH_FIELD, executionOf, factIdOf, formatRecordName } from "./seq-path.js";
import { FACT_GRAPH, getFact } from "./working-memory.js";
import { streamContext, streamOver } from "./step-stream-context.js";
import { capabilityAllows } from "./actions.js";
import { RUN_AUTHORITY, readingAt, runActingAs, runReadingAt } from "./capability-context.js";

// --- Test Steppers ---

class PlainStepper extends AStepper {
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

const [COUNT, COUNT_UNNAMED, ANSWER_AS, PASS_ON, ANSWER_WRONGLY] = ["count", "count unnamed", "answer as", "pass on", "answer wrongly as"];

/** Steps that count, and steps that run a statement and answer with what it answered, declared or not. */
class PassesOn extends AStepper implements IHasCycles {
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
	steps = {
		protectedPing: {
			gwta: "protected ping",
			capability: "CapabilityStepper:protected",
			action: () => OK,
		},
	};
}

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
			expect(() => authorizeToolCapability(tool, undefined)).toThrow(/capability CapabilityStepper:protected required/);
			expect(() => authorizeToolCapability(tool, "Other:*")).toThrow(/capability CapabilityStepper:protected required/);
		});

		it("refuses a step that reads more than its caller's read, or than the read in force where it is stated", () => {
			const tool = { method: "CapabilityStepper-look", capability: "CapabilityStepper:look", readsAt: Access.private };
			expect(() => authorizeToolCapability(tool, ["CapabilityStepper:look", "Read:public"])).toThrow(/capability Read:private required/);
			expect(() => authorizeToolCapability(tool, "*", Access.public)).toThrow("CapabilityStepper-look reads at private, and this call reads at public");
			expect(() => authorizeToolCapability(tool, "*", Access.private)).not.toThrow();
		});
	});

	describe("validateToolInput", () => {
		const toolTaking = (gwta: string, w: TWorld) => {
			const stepper = new (class extends AStepper {
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

		it("states no list of every domain or type a parameter naming one takes, and refuses an unregistered one", () => {
			const w = getDefaultWorld();
			const tool = toolTaking(`test {key: ${DOMAIN_DOMAIN_KEY}} {type: ${DOMAIN_PERSISTED_TYPE}}`, w);
			const { key, type } = tool.descriptor.inputSchema.properties as Record<string, { enum?: unknown }>;
			expect(key.enum, "no domain key listed").toBeUndefined();
			expect(type.enum, "no type listed").toBeUndefined();
			expect(validateToolInput([], tool, { key: DOMAIN_NUMBER, type: "Anything" }, w).key).toBe(DOMAIN_NUMBER);
			expect(() => validateToolInput([], tool, { key: "no-such-domain", type: "Anything" }, w)).toThrow(/`show domains` lists them/);
		});

		it("applies domain.coerce() when world is provided", () => {
			const w = getDefaultWorld();
			registerDomains(w, [
				[
					{
						selectors: ["myDomain"],
						schema: z.string(),
						coerce: (proto) => String(proto.value).toUpperCase(),
					},
				],
			]);
			const stepper = new (class extends AStepper {
				steps = { doIt: { gwta: "do it with {val: myDomain}", action: async () => OK } };
			})();
			const registry = buildStepRegistry([stepper], w);
			const tool = registry.get(`${stepper.constructor.name}-doIt`);
			if (!tool) throw new Error("Expected tool to be registered");
			const result = validateToolInput([], tool, { val: "hello" }, w);
			expect(result.val).toBe("HELLO");
		});

		it("takes a reference as its id, itself or its JSON text, as a feature line may give it, and refuses a number and text that isn't JSON", () => {
			const w = getDefaultWorld();
			registerDomains(w, [[individualRefDomain("test-ref", "test-target")]]);
			const stepper = new (class extends AStepper {
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
			registerDomains(w, [
				[
					{
						selectors: ["color"],
						schema: z.enum(["red", "green", "blue"]),
						values: ["red", "green", "blue"],
						description: "A color",
					},
				],
			]);
			const stepper = new PlainStepper();
			const discovery = discoverSteps(w, new StepRegistry([stepper], w), EVERY_DEFINITION, RUN_AUTHORITY);
			expect(Array.isArray(discovery.steps)).toBe(true);
			expect(discovery.steps.some((m) => m.method === "PlainStepper-greet")).toBe(true);
			expect(discovery.domains).toBeDefined();
			expect(discovery.domains["color"]).toMatchObject({ description: "A color", values: ["red", "green", "blue"] });
		});

		it("extracts enum values from z.enum domain schema when values not explicitly set", () => {
			const w = getDefaultWorld();
			registerDomains(w, [
				[
					{
						selectors: ["size"],
						schema: z.enum(["small", "medium", "large"]),
						description: "T-shirt size",
					},
				],
			]);
			const stepper = new PlainStepper();
			const discovery = discoverSteps(w, new StepRegistry([stepper], w), EVERY_DEFINITION, RUN_AUTHORITY);
			expect(discovery.domains["size"]).toMatchObject({ description: "T-shirt size", values: ["small", "medium", "large"] });
		});
	});

	describe("createStepHandler", () => {
		// Named as the registry names it: a tool is what its key says it is, and the step built from it is resolved by
		// that name when it is dispatched.
		const synth = (step: { stepperName: string; stepName: string; description: string }, input: Record<string, unknown>, seqPath: number[] = [0]) =>
			buildFeatureStepForTransport(
				{ descriptor: { method: stepMethodName(step.stepperName, step.stepName), stepperName: step.stepperName, stepName: step.stepName, pattern: step.description, paramDomains: {} } } as StepTool,
				input,
				seqPath,
			);

		it("states a call a transport carries as the line a feature would state for it", () => {
			const descriptor = { method: "S-click", stepperName: "S", stepName: "click", pattern: "click( invisible)? {target: page-target}", paramDomains: { target: "page-target" } };
			expect(buildFeatureStepForTransport({ descriptor } as StepTool, { target: "Knock" }, [0]).in).toBe('click "Knock"');
		});

		it("returns ok with products exactly as the action returned them, framework metadata (_seqPath etc.) is injected by dispatchStep, not the handler", async () => {
			const stepper = new ProductStepper();
			const handler = createStepHandler("ProductStepper", "getCount", stepper.steps.getCount);
			const result = await handler(synth({ stepperName: "ProductStepper", stepName: "getCount", description: "" }, {}), world);
			expect(result.ok).toBe(true);
			expect(result.products).toMatchObject({ count: 42 });
			// `_seqPath` is dispatcher-level metadata; createStepHandler intentionally
			// leaves products untouched so output schemas can stay strict.
			expect(result.products?._seqPath).toBeUndefined();
		});

		it("returns ok for plain step", async () => {
			const stepper = new PlainStepper();
			const handler = createStepHandler("PlainStepper", "greet", stepper.steps.greet);
			const result = await handler(synth({ stepperName: "PlainStepper", stepName: "greet", description: "greet {name}" }, { name: "world" }), world);
			expect(result.ok).toBe(true);
		});

		it("the bare handler does not stamp the seqPath into products (dispatcher does that after validation)", async () => {
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
			expect(result.errorMessage, "what it said, as a step that refuses").toBe("boom");
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

		it("judges an empty value a caller writes by its domain, since no fact stands for a value", async () => {
			const FILTER = "empty-means-every";
			registerDomains(world, [[{ selectors: [FILTER], schema: z.string(), description: "a filter an empty value runs everything by" }]]);
			const stepper = new (class extends AStepper {
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

		it("refuses products a step names no domain of, and checks what a step passes on against its statement's domain", async () => {
			const said = async (line: string) => {
				const res = await testWithWorld(getDefaultWorld(), line, [PassesOn]);
				return { ok: res.ok, error: res.failure?.error.message, products: res.featureResults?.[0]?.stepResults.find((r) => r.in === line)?.products };
			};
			expect((await said(COUNT_UNNAMED)).error, "a step answering with products of no domain").toMatch(/returned products and names no domain/);
			expect(await said(`${ANSWER_AS} ${COUNT}`), "a step passing on what its statement answered").toMatchObject({ ok: true, products: { count: 1 } });
			expect(await said(`${ANSWER_AS} ${ANSWER_AS} ${COUNT}`), "through a step that passes it on too").toMatchObject({ ok: true, products: { count: 1 } });
			expect((await said(`${PASS_ON} ${COUNT}`)).error, "a step passing it on that declares nothing").toMatch(/returned products and names no domain/);
			expect((await said(`${ANSWER_WRONGLY} ${COUNT}`)).error, "products not in its statement's domain").toMatch(/answering as PassesOn\.counts products failed schema validation/);
			const naming = new (class extends AStepper {
				steps = { names: { gwta: "name {n: number}", productsOf: "n", action: async () => OK } };
			})();
			expect(() => new StepRegistry([naming], world), "a step naming a parameter that takes no statement").toThrow(
				/productsOf names \{n\}, which is no statement its phrase takes/,
			);
		});

		it("pairs a record id with the parameter naming its type, and takes the id however a line gives it", async () => {
			const reads = new (class extends AStepper {
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
					buildFeatureStepForTransport(tool, validateToolInput(path, tool, { label: "Email", id }, world), path),
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
							steps = { reads: { action: async () => OK, ...step } as TStepperStep };
						})(),
					],
					world,
				);
			expect(() => declaring({ gwta: `read {label: ${DOMAIN_PERSISTED_TYPE}} {id: ${DOMAIN_RECORD_ID}}` }), "a record id paired with nothing").toThrow(
				/\{id\} is a record-id its recordIds pairs with no type/,
			);
			expect(() => declaring({ gwta: `read {label: string} {id: ${DOMAIN_RECORD_ID}}`, recordIds: { id: "label" } }), "paired with a parameter naming no type").toThrow(
				/recordIds pairs \{id\} with \{label\}, which names no type/,
			);
		});

		it("names the step each call is part of, where two steps are in flight at once", async () => {
			let started = 0;
			let release = () => undefined as void;
			const released = new Promise<void>((resolve) => (release = resolve));
			const stepper = new (class extends AStepper {
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
			expect(logged.find((log) => log.message === "first")?.id, "the first step's statement names the first step").toMatch(/^0\.8\.1\.log\./);
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
			class Held extends AStepper {
				steps = {
					readsAtCeiling: { gwta: "read at the ceiling", productsDomain: TEST_DOMAIN.readAt, action: async () => actionOKWithProducts({ at: readingAt() ?? "unbounded" }) },
					describesItself: { gwta: "describe this", read: true, action: async () => OK },
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

			it("refuses a step that declares nothing to a caller not holding its name, and a read to a caller holding no read", async () => {
				const { call } = held();
				await expect(call("readsAtCeiling", [], [0, 20, 1])).rejects.toThrow(/capability Held:readsAtCeiling required/);
				await expect(call("describesItself", [], [0, 20, 2]), "no step is open to a caller holding nothing").rejects.toThrow(/capability Read:public required/);
				expect((await call("describesItself", ["Read:private"], [0, 20, 3])).ok, "a broader read allows it").toBe(true);
			});

			it("bounds what a step reads by the broadest read its caller holds, and at public for a caller holding none", async () => {
				const { call } = held();
				expect((await call("readsAtCeiling", ["Held:readsAtCeiling"], [0, 21, 1])).products?.at).toBe("public");
				expect((await call("readsAtCeiling", ["Held:readsAtCeiling", "Read:opened"], [0, 21, 2])).products?.at).toBe("opened");
				expect((await call("readsAtCeiling", RUN_AUTHORITY, [0, 21, 3])).products?.at, "the run reads everything it holds").toBe("private");
				expect((await runReadingAt("public", () => call("readsAtCeiling", RUN_AUTHORITY, [0, 21, 4]))).products?.at, "and never above a ceiling already in force").toBe("public");
			});

			it("records what a caller's step required and held and who proved it, and nothing of authority for the run's own", async () => {
				const { call, fieldOf } = held();
				await runActingAs("did:example:alice", () => call("readsAtCeiling", ["Held:readsAtCeiling"], [0, 22, 1]));
				expect(await fieldOf([0, 22, 1], SEQ_PATH_FIELD.capabilityAction)).toBe("Held:readsAtCeiling");
				expect(await fieldOf([0, 22, 1], SEQ_PATH_FIELD.allowedAction)).toBe("Held:readsAtCeiling");
				expect(await fieldOf([0, 22, 1], LinkRelations.PERFORMED_BY.rel)).toBe("did:example:alice");
				await call("readsAtCeiling", RUN_AUTHORITY, [0, 22, 2]);
				expect(await fieldOf([0, 22, 2], SEQ_PATH_FIELD.capabilityAction), "the run holds everything, and its step says nothing of it").toBeUndefined();
				expect(await fieldOf([0, 22, 2], SEQ_PATH_FIELD.allowedAction)).toBeUndefined();
			});
		});

		it("answers a read the run did not ask for without recording it, however that read arrived, and records the read a feature states in its own body", async () => {
			const stepper = new (class extends AStepper {
				steps = {
					howMany: { gwta: "how many", read: true, productsDomain: TEST_DOMAIN.count, action: async () => actionOKWithProducts({ count: 3 }) },
				};
			})();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get(`${stepper.constructor.name}-howMany`);
			if (!tool) throw new Error("Expected the read to be registered");
			const store = world.shared.getStore();
			const recordOf = (path: number[]) => store.query({ subject: formatRecordName({ execution: executionOf(world.tag), path }), namedGraph: SEQ_PATH_LABEL });

			// Over a transport, which is how a page reads a run it follows. Every transport marks its step programmatic.
			const overATransport = buildFeatureStepForTransport(tool, {}, [0, 9, 1]);
			expect(overATransport.programmatic, "a transport states that the run did not ask").toBe(true);
			let kept = world.runtime.stepResults?.length ?? 0;
			const answered = await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, overATransport);
			expect(answered.ok).toBe(true);
			expect(answered.products, "the question is answered").toMatchObject({ count: 3 });
			expect(await recordOf([0, 9, 1]), "no record of the run being read over a transport").toEqual([]);
			expect(await getFact(world, TEST_DOMAIN.count, factIdOf("0.9.1"), FACT_GRAPH), "and no fact of what it answered").toBeUndefined();
			expect(world.runtime.stepResults?.length ?? 0, "nothing kept in the process for it").toBe(kept);

			// Beneath a step the feature states, which is the feature reading through a combinator: `set x from <a read>`
			// answers from the read's own result, so the read is a step of the run like the line that stated it.
			const beneathAStep = buildFeatureStepForTransport(tool, {}, [0, 9, 2]);
			beneathAStep.programmatic = undefined;
			beneathAStep.isSubStep = true;
			kept = world.runtime.stepResults?.length ?? 0;
			await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, beneathAStep);
			expect((await recordOf([0, 9, 2])).length, "a read the feature stated through a combinator is the run reading").toBeGreaterThan(0);
			expect(world.runtime.stepResults?.length ?? 0, "and its result is the one the line reads").toBe(kept + 1);

			// The same read written in a feature's own body: the run reading is a step of the run.
			const inTheFeature = buildFeatureStepForTransport(tool, {}, [0, 9, 3]);
			inTheFeature.programmatic = undefined;
			kept = world.runtime.stepResults?.length ?? 0;
			const run = await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, inTheFeature);
			expect(run.ok).toBe(true);
			expect((await recordOf([0, 9, 3])).length, "a read a feature states is a step of the run").toBeGreaterThan(0);
			expect(await getFact(world, TEST_DOMAIN.count, factIdOf("0.9.3"), FACT_GRAPH), "whose answer is a fact of the run").toMatchObject({ count: 3 });
			expect(world.runtime.stepResults?.length ?? 0, "and is kept with the run's other steps").toBe(kept + 1);
		});

		it("states a step its caller stopped as stopped, in its record and its end event, where a step that fails unstopped failed", async () => {
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
				streamOver(() => undefined),
				() => dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, buildFeatureStepForTransport(tool, {}, [0, 3, 7])),
			);
			expect(await statusOf([0, 3, 6]), "the stopped step's record").toBe(SEQ_PATH_STATUS.stopped);
			expect(await statusOf([0, 3, 7]), "a step that failed on its own").toBe(SEQ_PATH_STATUS.failed);
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
			expect(byPredicate[SEQ_PATH_FIELD.actionStatus]).toBe(SEQ_PATH_STATUS.passed);
			expect(byPredicate[SEQ_PATH_FIELD.generatedAtTime]).toEqual(expect.any(String));
			expect(byPredicate[SEQ_PATH_FIELD.endedAtTime]).toEqual(expect.any(String));
			expect(byPredicate[LinkRelations.PART_OF.rel], "a step is part of its parent step of the same execution").toBe(
				formatRecordName({ execution: executionOf(world.tag), path: [0, 3] }),
			);
			expect(byPredicate[SEQ_PATH_FIELD.stepText]).toEqual(expect.any(String));
			// Written even for the ordinary case: a reader asking for the steps that were NOT speculative can only be
			// answered if an authoritative step says so as well.
			expect(byPredicate[SEQ_PATH_FIELD.mode]).toBe("authoritative");
		});

		it("records the mode a step ran under, so speculative and authoritative can be told apart afterwards", async () => {
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
			expect(mode, "a try whose failure is expected is not the run failing, and its record says which it was").toBe("speculative");
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
			expect(status).toBe(SEQ_PATH_STATUS.failed);
		});
	});

	describe("domain-anchored I/O", () => {
		const TestEmailSchema = z.object({ id: z.string(), subject: z.string() });

		class DomainEchoStepper extends AStepper {
			steps = {
				produceEmail: {
					gwta: "produce an email",
					productsDomain: "test-email",
					action: () => actionOKWithProducts({ id: "e1", subject: "hi" }),
				},
				unregisteredInput: {
					gwta: "consume {who: no-such-domain}",
					action: () => OK,
				},
				dualOutput: {
					gwta: "produce two outputs",
					productsDomain: "test-email",
					productsDomains: { x: "string" },
					action: () => actionOKWithProducts({ id: "e", subject: "s" }),
				},
				unknownDomain: {
					gwta: "produce a ghost",
					productsDomain: "not-registered",
					action: () => actionOKWithProducts({}),
				},
			};
		}

		beforeEach(() => {
			registerDomains(world, [
				[
					{
						selectors: ["test-email"],
						schema: TestEmailSchema,
						description: "Test email",
					},
				],
			]);
		});

		it("records the view a step showed, by the name the site declares it under", async () => {
			registerDomains(world, [[{ selectors: ["test-view"], schema: z.object({}), description: "A view", ui: { component: "test-view-element" } }]]);
			class ShowsAView extends AStepper {
				steps = { showIt: { gwta: "show the view", productsDomain: "test-view", action: () => actionOKWithProducts({}) } };
			}
			const steppers = [new ShowsAView()];
			const registry = buildStepRegistry(steppers, world);
			const tool = registry.get("ShowsAView-showIt");
			if (!tool) throw new Error("Expected ShowsAView-showIt to be registered");
			const featureStep = buildFeatureStepForTransport(tool, {}, [0, 7, 1]);
			await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, featureStep);
			const showed = await world.shared.getStore().get(formatRecordName({ execution: executionOf(world.tag), path: [0, 7, 1] }), SEQ_PATH_FIELD.showed, SEQ_PATH_LABEL);
			expect(showed, "what the step showed, which is what a document embeds it by").toBe("test-view");
		});

		it("registers a step with productsDomain referencing a known domain", () => {
			class JustProduce extends AStepper {
				steps = { produceEmail: new DomainEchoStepper().steps.produceEmail };
			}
			const registry = buildStepRegistry([new JustProduce()], world);
			const tool = registry.get("JustProduce-produceEmail");
			expect(tool?.descriptor.outputSchema).toBeDefined();
		});

		it("refuses a parameter whose domain no stepper registers, naming the step, the parameter and the domain", () => {
			class JustUnregistered extends AStepper {
				steps = { unregisteredInput: new DomainEchoStepper().steps.unregisteredInput };
			}
			expect(() => buildStepRegistry([new JustUnregistered()], world)).toThrow(
				'step JustUnregistered.unregisteredInput: {who} names the domain "no-such-domain", which no loaded stepper registers.',
			);
		});

		it("rejects mutually exclusive productsDomain and productsDomains", () => {
			class JustDual extends AStepper {
				steps = { dualOutput: new DomainEchoStepper().steps.dualOutput };
			}
			expect(() => buildStepRegistry([new JustDual()], world)).toThrow(/only one of/);
		});

		it("rejects productsDomain referencing an unregistered domain", () => {
			class JustUnknown extends AStepper {
				steps = { unknownDomain: new DomainEchoStepper().steps.unknownDomain };
			}
			expect(() => buildStepRegistry([new JustUnknown()], world)).toThrow(/not a registered domain/);
		});
	});

	describe("_links derivation, H1 next-action affordances from paramDomains", () => {
		const VcSchema = z.object({ id: z.string(), subject: z.string() }).describe("A signed claim about a subject.");
		const VcRefSchema = z.object({ id: z.string() }).describe("Reference to a credential by id.");

		class IssuerStepper extends AStepper {
			steps = {
				issueDemoCredential: {
					gwta: "issue demo credential",
					productsDomain: "demo-vc",
					action: () => actionOKWithProducts({ id: "vc-1", subject: "did:example:alice" }),
				},
				revokeDemo: {
					gwta: "revoke {credential: demo-vc}",
					productsDomain: "demo-vc",
					action: () => actionOKWithProducts({ id: "vc-1", subject: "did:example:alice" }),
				},
				suspendDemo: {
					gwta: "suspend {credential: demo-vc}",
					productsDomain: "demo-vc",
					action: () => actionOKWithProducts({ id: "vc-1", subject: "did:example:alice" }),
				},
				unrelatedStep: {
					gwta: "do unrelated thing {name: string}",
					action: () => OK,
				},
			};
		}

		beforeEach(() => {
			registerDomains(world, [
				[
					{ selectors: ["demo-vc"], schema: VcSchema, description: "Verifiable credential vertex" },
					{ selectors: ["demo-vc-ref"], schema: VcRefSchema, description: "Credential reference" },
				],
			]);
		});

		it("populates `_links` with every step whose param domain matches the product's productsDomain", async () => {
			const stepper = new IssuerStepper();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("IssuerStepper-issueDemoCredential");
			if (!tool) throw new Error("Expected IssuerStepper-issueDemoCredential to be registered");

			const featureStep = buildFeatureStepForTransport(tool, {}, [0, 1]);
			const result = await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, featureStep);
			expect(result.ok).toBe(true);

			const products = result.products as Record<string, unknown>;
			const links = products._links as Record<string, { method: string; params?: Record<string, unknown> }> | undefined;
			expect(links).toBeDefined();
			// Two follow-on verbs accept demo-vc as input, revoke and suspend. The issue step itself accepts no demo-vc input so it is NOT listed.
			expect(Object.keys(links ?? {}).sort()).toEqual(["revokeDemo", "suspendDemo"]);
			// Method is the canonical fully-qualified dispatch address; params skeleton is populated from the product's `id`.
			expect(links?.revokeDemo).toEqual({ method: "IssuerStepper-revokeDemo", params: { credential: { id: "vc-1" } } });
			expect(links?.suspendDemo).toEqual({ method: "IssuerStepper-suspendDemo", params: { credential: { id: "vc-1" } } });
		});

		it("emits no `_links` when no other step accepts this product's domain", async () => {
			class IsolatedStepper extends AStepper {
				steps = {
					produce: {
						gwta: "produce a lone product",
						productsDomain: "lone-domain",
						action: () => actionOKWithProducts({ id: "x" }),
					},
				};
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
			// No follow-on verbs accept lone-domain: the `_links` marker must be absent, not an empty object, so consumers can rely on `_links` always being a non-empty Record when present.
			expect(products._links).toBeUndefined();
		});

		it("follows topology.ranges.id from a ref domain to the persisted domain, `revoke {credential: vc-ref}` links from a `vc-vertex` product", async () => {
			// individualRef pattern: a step accepts a ref domain whose schema is `{id}` and whose topology.ranges.id points to the produce-side persisted domain. The affordance derivation must walk this indirection: the SAME pattern @haibun/core's individualRefDomain establishes for every CRUD verb in the credentials / imap-graph / file-stepper / person-stepper steppers.
			class VertexRefStepper extends AStepper {
				steps = {
					produceVc: {
						gwta: "produce a vc",
						productsDomain: "vc-vertex",
						action: () => actionOKWithProducts({ id: "vc-1" }),
					},
					revokeVc: {
						gwta: "revoke {credential: vc-ref}",
						productsDomain: "vc-revocation",
						action: () => actionOKWithProducts({ revoked: true }),
					},
				};
			}
			registerDomains(world, [
				[
					{ selectors: ["vc-vertex"], schema: z.object({ id: z.string() }), description: "VC vertex" },
					{ selectors: ["vc-ref"], schema: z.object({ id: z.string() }), description: "Reference to a VC by id", topology: { ranges: { id: "vc-vertex" } } },
					{ selectors: ["vc-revocation"], schema: z.object({ revoked: z.boolean() }), description: "Revocation outcome" },
				],
			]);
			const stepper = new VertexRefStepper();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("VertexRefStepper-produceVc");
			if (!tool) throw new Error("Expected VertexRefStepper-produceVc to be registered");

			const featureStep = buildFeatureStepForTransport(tool, {}, [0, 1]);
			const result = await dispatchStep({ registry, world, steppers, grantedCapability: RUN_AUTHORITY }, featureStep);
			expect(result.ok).toBe(true);

			const products = result.products as Record<string, unknown>;
			const links = products._links as Record<string, { method: string; params?: Record<string, unknown> }> | undefined;
			expect(links).toBeDefined();
			// revokeVc accepts `vc-ref`, whose topology.ranges.id === "vc-vertex". The derivation follows that range and emits the affordance, populating the ref's `{id}` shape from the product's id.
			expect(links?.revokeVc).toEqual({ method: "VertexRefStepper-revokeVc", params: { credential: { id: "vc-1" } } });
		});

		it("omits params skeleton when the product has no `id`: the consumer fills params from the step's shown schema", async () => {
			class IdlessStepper extends AStepper {
				steps = {
					produce: {
						gwta: "produce an idless thing",
						productsDomain: "idless",
						action: () => actionOKWithProducts({ name: "thing" }),
					},
					consume: {
						gwta: "consume {what: idless}",
						action: () => OK,
					},
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
	it("keeps none when false", () => {
		expect(retainedProducts(p, false)).toBeUndefined();
	});
	it("keeps the filter's subset, descriptor kept, payload dropped", () => {
		const keepDescriptor = (x: Record<string, unknown>) => ({ _component: x._component, id: x.id });
		expect(retainedProducts(p, keepDescriptor)).toEqual({ _component: "shu-thread-column", id: "x" });
	});
	it("keeps none when the filter returns undefined or there are no products", () => {
		expect(retainedProducts(p, () => undefined)).toBeUndefined();
		expect(retainedProducts(undefined, (x) => x)).toBeUndefined();
	});
});
