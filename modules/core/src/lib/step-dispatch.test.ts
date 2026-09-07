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
	capabilityAllows,
	StepRegistry,
	type StepTool,
} from "./step-registry.js";
import { validateToolInput } from "./tool-validation.js";
import { AStepper, type TStepperStep } from "./astepper.js";
import { OK } from "../schema/protocol.js";
import { actionOKWithProducts, actionNotOK } from "./util/index.js";
import { getDefaultWorld } from "./test/lib.js";
import { registerDomains } from "./domains.js";
import type { TWorld } from "./world.js";
import { LinkRelations, SEQ_PATH_LABEL, SEQ_PATH_STATUS } from "./resources.js";
import { SEQ_PATH_FIELD, executionOf, formatRecordName } from "./seq-path.js";

// --- Test Steppers ---

class PlainStepper extends AStepper {
	steps = {
		greet: {
			gwta: "say hello to {name}",
			action: ({ name }: { name: string }) => {
				return OK;
			},
		},
		hidden: {
			gwta: "do secret thing",
			exposeMCP: false,
			action: async () => OK,
		},
	};
}

const PRODUCT_COUNT_DOMAIN = "product-count";
const ProductCountSchema = z.object({ count: z.number() });

class ProductStepper extends AStepper {
	cycles = {
		getConcerns: () => ({
			domains: [{ selectors: [PRODUCT_COUNT_DOMAIN], schema: ProductCountSchema, description: "A counted product" }],
		}),
	};
	steps = {
		getCount: {
			gwta: "get the count",
			productsDomain: PRODUCT_COUNT_DOMAIN,
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
		world.domains[PRODUCT_COUNT_DOMAIN] = { selectors: [PRODUCT_COUNT_DOMAIN], schema: ProductCountSchema, coerce: (p) => p.value, description: "A counted product" };
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

		it("includes exposeMCP:false steps in registry (MCP filters separately)", () => {
			const stepper = new PlainStepper();
			const registry = buildStepRegistry([stepper], world);
			expect(registry.has("PlainStepper-hidden")).toBe(true);
		});

		it("includes outputSchema when defined", () => {
			const stepper = new ProductStepper();
			const registry = buildStepRegistry([stepper], world);
			const tool = registry.get("ProductStepper-getCount");
			expect(tool?.outputSchema).toBeDefined();
		});

		it("builds input schema with required params", () => {
			const stepper = new PlainStepper();
			const registry = buildStepRegistry([stepper], world);
			const tool = registry.get("PlainStepper-greet");
			expect(tool?.inputSchema.required).toContain("name");
			expect(tool?.inputSchema.properties?.["name"]).toBeDefined();
		});

		it("propagates step capability metadata", () => {
			const stepper = new CapabilityStepper();
			const registry = buildStepRegistry([stepper], world);
			expect(registry.get("CapabilityStepper-protectedPing")?.capability).toBe("CapabilityStepper:protected");
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
			const tool = { name: "CapabilityStepper-protectedPing", capability: "CapabilityStepper:protected" };
			expect(() => authorizeToolCapability(tool, undefined)).toThrow(/capability CapabilityStepper:protected required/);
			expect(() => authorizeToolCapability(tool, "Other:*")).toThrow(/capability CapabilityStepper:protected required/);
		});
	});

	describe("validateToolInput", () => {
		const makeTool = (overrides: Partial<StepTool> & { paramSchemas: StepTool["paramSchemas"] }): StepTool => ({
			name: "test",
			description: "test",
			inputSchema: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
			paramDomainKeys: new Map(),
			stepperName: "Test",
			stepName: "test",
			handler: async () => ({ ok: true }),
			...overrides,
		});

		it("passes valid input", () => {
			const tool = makeTool({ paramSchemas: new Map([["x", z.string()]]) });
			const result = validateToolInput([], tool, { x: "hello" });
			expect(result.x).toBe("hello");
		});

		it("throws on missing required input", () => {
			const tool = makeTool({ paramSchemas: new Map([["x", z.string()]]) });
			expect(() => validateToolInput([], tool, {})).toThrow(/validation failed.*"x": required/);
		});

		it("throws on invalid type", () => {
			const tool = makeTool({
				inputSchema: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
				paramSchemas: new Map([["x", z.number()]]),
			});
			expect(() => validateToolInput([], tool, { x: "not-a-number" })).toThrow(/validation failed/);
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

		it("skips coerce when world is not provided", () => {
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
			// Without world, no coercion — returns Zod-parsed value as-is
			const result = validateToolInput([], tool, { val: "hello" });
			expect(result.val).toBe("hello");
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
			const discovery = discoverSteps([stepper], w);
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
			const discovery = discoverSteps([stepper], w);
			expect(discovery.domains["size"]).toMatchObject({ description: "T-shirt size", values: ["small", "medium", "large"] });
		});

		it("step.list steps includes inputSchema", () => {
			const stepper = new PlainStepper();
			const discovery = discoverSteps([stepper], world);
			const greet = discovery.steps.find((m) => m.method === "PlainStepper-greet");
			expect(greet?.inputSchema).toBeDefined();
			expect(greet?.inputSchema?.required).toContain("name");
		});

		it("step.list steps includes capability", () => {
			const stepper = new CapabilityStepper();
			const discovery = discoverSteps([stepper], world);
			expect(discovery.steps.find((m) => m.method === "CapabilityStepper-protectedPing")?.capability).toBe("CapabilityStepper:protected");
		});

		it("omits capability-gated steps when the caller lacks the grant", () => {
			const steppers = [new PlainStepper(), new CapabilityStepper()];
			const discovery = discoverSteps(steppers, world, undefined, { grantedCapability: [] });
			const methods = discovery.steps.map((s) => s.method);
			expect(methods).toContain("PlainStepper-greet");
			expect(methods).not.toContain("CapabilityStepper-protectedPing");
		});

		it("includes capability-gated steps when the caller holds the matching grant", () => {
			const steppers = [new PlainStepper(), new CapabilityStepper()];
			const discovery = discoverSteps(steppers, world, undefined, {
				grantedCapability: ["CapabilityStepper:protected"],
			});
			const methods = discovery.steps.map((s) => s.method);
			expect(methods).toContain("PlainStepper-greet");
			expect(methods).toContain("CapabilityStepper-protectedPing");
		});

		it("wildcard grants admit every matching capability", () => {
			const steppers = [new CapabilityStepper()];
			const discovery = discoverSteps(steppers, world, undefined, { grantedCapability: "*" });
			const methods = discovery.steps.map((s) => s.method);
			expect(methods).toContain("CapabilityStepper-protectedPing");
		});

		it("passes through the full manifest when no grant context is supplied", () => {
			const steppers = [new CapabilityStepper()];
			const discovery = discoverSteps(steppers, world);
			expect(discovery.steps.find((m) => m.method === "CapabilityStepper-protectedPing")).toBeDefined();
		});
	});

	describe("createStepHandler", () => {
		// Named as the registry names it: a tool is what its key says it is, and the step built from it is resolved by
		// that name when it is dispatched.
		const synth = (tool: { stepperName: string; stepName: string; description: string }, input: Record<string, unknown>, seqPath: number[] = [0]) =>
			buildFeatureStepForTransport({ ...tool, name: stepMethodName(tool.stepperName, tool.stepName) } as StepTool, input, seqPath);

		it("returns ok with products exactly as the action returned them — framework metadata (_seqPath etc.) is injected by dispatchStep, not the handler", async () => {
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
			expect(result.errorMessage).toContain("boom");
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

		it("denies missing capability", async () => {
			const stepper = new CapabilityStepper();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("CapabilityStepper-protectedPing");
			if (!tool) throw new Error("Expected protected tool to be registered");

			const featureStep = buildFeatureStepForTransport(tool, {}, [0, 1]);
			await expect(dispatchStep({ registry, world, steppers }, featureStep)).rejects.toThrow(/capability CapabilityStepper:protected required/);
		});

		it("emits SeqPath quads for a passing step", async () => {
			const stepper = new ProductStepper();
			const steppers = [stepper];
			const registry = new StepRegistry(steppers, world);
			const tool = registry.get("ProductStepper-getCount");
			if (!tool) throw new Error("Expected ProductStepper-getCount to be registered");

			const featureStep = buildFeatureStepForTransport(tool, {}, [0, 3, 5]);
			const result = await dispatchStep({ registry, world, steppers }, featureStep);
			expect(result.ok).toBe(true);

			const store = world.shared.getStore();
			const id = formatRecordName({ execution: executionOf(world.tag), path: [0, 3, 5] });
			const quads = await store.query({ subject: id, namedGraph: SEQ_PATH_LABEL });
			const byPredicate = Object.fromEntries(quads.map((q) => [q.predicate, q.object]));
			expect(byPredicate[SEQ_PATH_FIELD.actionStatus]).toBe(SEQ_PATH_STATUS.passed);
			expect(byPredicate[SEQ_PATH_FIELD.generatedAtTime]).toEqual(expect.any(String));
			expect(byPredicate[SEQ_PATH_FIELD.endedAtTime]).toEqual(expect.any(String));
			expect(byPredicate[LinkRelations.PART_OF.rel], "a step is part of its parent step of the same execution").toBe(formatRecordName({ execution: executionOf(world.tag), path: [0, 3] }));
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
			await dispatchStep({ registry, world, steppers }, featureStep);

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
			const result = await dispatchStep({ registry, world, steppers }, featureStep);
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
				badInputDomain: {
					gwta: "send {who: string}",
					inputDomains: { who: "test-email" },
					action: () => OK,
				},
				ungatedConsumer: {
					gwta: "consume an email {who: string}",
					inputDomains: { who: "string" },
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
			await dispatchStep({ registry, world, steppers }, featureStep);
			const showed = await world.shared.getStore().get(formatRecordName({ execution: executionOf(world.tag), path: [0, 7, 1] }), SEQ_PATH_FIELD.showed, SEQ_PATH_LABEL);
			expect(showed, "what the step showed, which is what a document embeds it by").toBe("test-view");
		});

		it("registers a step with productsDomain referencing a known domain", () => {
			class JustProduce extends AStepper {
				steps = { produceEmail: new DomainEchoStepper().steps.produceEmail };
			}
			const registry = buildStepRegistry([new JustProduce()], world);
			const tool = registry.get("JustProduce-produceEmail");
			expect(tool?.outputSchema).toBeDefined();
		});

		it("rejects inputDomains that disagrees with the gwta-derived domain", () => {
			const stepper = new DomainEchoStepper();
			const subset = { ...stepper.steps, badInputDomain: stepper.steps.badInputDomain };
			class JustBad extends AStepper {
				steps = { badInputDomain: subset.badInputDomain };
			}
			expect(() => buildStepRegistry([new JustBad()], world)).toThrow(/disagrees/);
		});

		it("accepts inputDomains aligned with the gwta-derived domain", () => {
			class JustOk extends AStepper {
				steps = { ungatedConsumer: new DomainEchoStepper().steps.ungatedConsumer };
			}
			expect(() => buildStepRegistry([new JustOk()], world)).not.toThrow();
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

	describe("_links derivation — H1 next-action affordances from paramDomains", () => {
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
			const result = await dispatchStep({ registry, world, steppers }, featureStep);
			expect(result.ok).toBe(true);

			const products = result.products as Record<string, unknown>;
			const links = products._links as Record<string, { method: string; params?: Record<string, unknown> }> | undefined;
			expect(links).toBeDefined();
			// Two follow-on verbs accept demo-vc as input — revoke and suspend. The issue step itself accepts no demo-vc input so it is NOT listed.
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
			const result = await dispatchStep({ registry, world, steppers }, featureStep);
			expect(result.ok).toBe(true);

			const products = result.products as Record<string, unknown>;
			// No follow-on verbs accept lone-domain — the `_links` marker must be absent, not an empty object, so consumers can rely on `_links` always being a non-empty Record when present.
			expect(products._links).toBeUndefined();
		});

		it("follows topology.ranges.id from a ref domain to the persisted domain — `revoke {credential: vc-ref}` links from a `vc-vertex` product", async () => {
			// individualRef pattern: a step accepts a ref domain whose schema is `{id}` and whose topology.ranges.id points to the produce-side persisted domain. The affordance derivation must walk this indirection — the SAME pattern @haibun/core's individualRefDomain establishes for every CRUD verb in the credentials / imap-graph / file-stepper / person-stepper steppers.
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
			const result = await dispatchStep({ registry, world, steppers }, featureStep);
			expect(result.ok).toBe(true);

			const products = result.products as Record<string, unknown>;
			const links = products._links as Record<string, { method: string; params?: Record<string, unknown> }> | undefined;
			expect(links).toBeDefined();
			// revokeVc accepts `vc-ref`, whose topology.ranges.id === "vc-vertex". The derivation follows that range and emits the affordance, populating the ref's `{id}` shape from the product's id.
			expect(links?.revokeVc).toEqual({ method: "VertexRefStepper-revokeVc", params: { credential: { id: "vc-1" } } });
		});

		it("omits params skeleton when the product has no `id` — the consumer fills params from step.list", async () => {
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
			const result = await dispatchStep({ registry, world, steppers }, featureStep);
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
	it("keeps the filter's subset — descriptor kept, payload dropped", () => {
		const keepDescriptor = (x: Record<string, unknown>) => ({ _component: x._component, id: x.id });
		expect(retainedProducts(p, keepDescriptor)).toEqual({ _component: "shu-thread-column", id: "x" });
	});
	it("keeps none when the filter returns undefined or there are no products", () => {
		expect(retainedProducts(p, () => undefined)).toBeUndefined();
		expect(retainedProducts(undefined, (x) => x)).toBeUndefined();
	});
});
