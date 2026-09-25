import { describe, it, expect } from "vitest";
import { z } from "zod";
import { getDefaultWorld, getTestWorldWithOptions } from "./test/lib";
import { populateActionArgs } from "./populateActionArgs";
import { TFeatureStep } from "./defs";
import { Origin } from "../schema/protocol.js";
import { AStepper } from "./astepper.js";
import { DOMAIN_NUMBER, DOMAIN_STRING, DOMAIN_VARIABLE_NAME, individualRefDomain, registerDomains } from "./domains.js";
import { fromJsonText } from "./json-text.js";

function makeStep(name: string, label: string, domain: string, origin: Origin): TFeatureStep {
	return {
		source: { path: "test" },
		in: "",
		seqPath: [0],
		action: {
			actionName: "test",
			stepperName: "test",
			step: {
				action: () => {
					return Promise.resolve({ ok: true });
				},
			},
			stepValuesMap: {
				[name]: { term: label, domain, origin },
			},
		},
	};
}

describe("populateActionArgs integration", () => {
	it("takes the term a written domain's parameter writes, and not a variable of that name", async () => {
		const world = getTestWorldWithOptions();
		await world.shared.set({ term: "bar", value: "the variable's value", domain: DOMAIN_STRING, origin: Origin.var }, { in: "test", seq: [0], when: "test" });
		expect((await populateActionArgs(makeStep("foo", "bar", DOMAIN_VARIABLE_NAME, Origin.defined), world, [])).foo).toBe("bar");
		expect((await populateActionArgs(makeStep("foo", "bar", DOMAIN_VARIABLE_NAME, Origin.quoted), world, [])).foo).toBe("bar");
	});

	it("resolves env origin", async () => {
		const step = makeStep("foo", "ENV_VAR", "string", Origin.env);
		const world = getTestWorldWithOptions({ options: { DEST: "test", envVariables: { ENV_VAR: "envval" } }, moduleOptions: {} });
		const steppers: AStepper[] = [];
		const args = await populateActionArgs(step, world, steppers);
		expect(args.foo).toBe("envval");
	});

	it("throws on missing env variable", async () => {
		const step = makeStep("foo", "NOPE", "string", Origin.env);
		const world = getTestWorldWithOptions();
		const steppers: AStepper[] = [];
		await expect(async () => await populateActionArgs(step, world, steppers)).rejects.toThrow();
	});

	it("throws on missing domain coercer", async () => {
		const step = makeStep("foo", "bar", "notadomain", Origin.quoted);
		const world = getTestWorldWithOptions();
		const steppers: AStepper[] = [];
		await expect(async () => await populateActionArgs(step, world, steppers)).rejects.toThrow();
	});
});

describe("a parameter's domain", () => {
	const PROVENANCE = { seq: [0], when: "test" };
	const worldWith = async (variables: { term: string; value: unknown; domain: string }[]) => {
		const world = getDefaultWorld();
		registerDomains(world, [
			[
				{ selectors: ["thing"], schema: z.object({ id: z.string(), name: z.string() }), description: "a thing" },
				individualRefDomain("thing-ref", "thing"),
				{ selectors: ["other"], schema: z.object({ id: z.string() }), description: "another thing" },
				{ selectors: ["pair"], schema: fromJsonText(z.object({ a: z.number(), b: z.number() })), description: "two numbers" },
			],
		]);
		for (const variable of variables) await world.shared.set({ ...variable, origin: Origin.var }, PROVENANCE);
		return world;
	};

	it("reads a variable holding a primitive by the domain's schema", async () => {
		const world = await worldWith([{ term: "n", value: "5", domain: DOMAIN_STRING }]);
		expect((await populateActionArgs(makeStep("count", "n", DOMAIN_NUMBER, Origin.var), world, [])).count).toBe(5);
	});

	it("takes an individual where the domain is a reference to one, as its reference", async () => {
		const world = await worldWith([{ term: "t", value: { id: "t1", name: "a thing" }, domain: "thing" }]);
		expect((await populateActionArgs(makeStep("which", "t", "thing-ref", Origin.var), world, [])).which).toEqual({ id: "t1" });
	});

	it("refuses a variable of another domain, naming both", async () => {
		const world = await worldWith([{ term: "o", value: { id: "o1" }, domain: "other" }]);
		await expect(populateActionArgs(makeStep("which", "o", "thing-ref", Origin.var), world, [])).rejects.toThrow("step test.test: {which} takes thing-ref, and o holds other");
	});

	it("refuses text that isn't JSON at once, naming the step, the parameter and the parser's reason", async () => {
		const world = await worldWith([]);
		await expect(populateActionArgs(makeStep("both", '"{a: 1"', "pair", Origin.quoted), world, [])).rejects.toThrow(
			/^step test\.test: \{both\} refuses "\{a: 1": is text that isn't JSON \(.+\): \{a: 1$/,
		);
	});

	it("refuses JSON that isn't of the domain, naming the field", async () => {
		const world = await worldWith([]);
		await expect(populateActionArgs(makeStep("both", '"{"a": 1}"', "pair", Origin.quoted), world, [])).rejects.toThrow(/^step test\.test: \{both\} refuses .*: b: Invalid input/);
	});
});
