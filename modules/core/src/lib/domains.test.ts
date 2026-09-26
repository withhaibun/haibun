import { describe, it, expect } from "vitest";
import { failWithDefaults, getDefaultWorld, passWithDefaults } from "./test/lib.js";
import VariablesStepper from "../steps/variables-stepper.js";
import Haibun from "../steps/haibun.js";
import LogicStepper from "../steps/logic-stepper.js";
import { z } from "zod";
import {
	DOMAIN_ACTIONS,
	DOMAIN_DURATION,
	DOMAIN_HYPERMEDIA_DECLARATION,
	DOMAIN_SET_VALUES,
	DOMAIN_STEP_PATH,
	refDomainKey,
	refTargetOf,
	registerDomains,
	toRegisteredDomain,
} from "./domains.js";
import { LinkRelations, PersistedVertexSchema, type THypermediaTopology, type TPropertyDef } from "./resources.js";

const steppers = [VariablesStepper, Haibun, LogicStepper];

describe("domains", () => {
	it("sets variable with explicit domain", async () => {
		const feature = { path: "/features/d.feature", content: 'set sel as string to "#login"\nvariable "sel" is "#login"' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
	it("sets multi word variable with domain", async () => {
		const feature = {
			path: "/features/d.feature",
			content: 'set sel et poivre as string to "#login"\nvariable sel et poivre is "#login"',
		};
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});

	it("fails on unknown domain in set", async () => {
		const feature = { path: "/features/d.feature", content: 'set x as unknown-domain to "y"' };
		const res = await failWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});

	it("fails on invalid number coercion", async () => {
		const feature = { path: "/features/d.feature", content: 'set n as number to "abc"' };
		const res = await failWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});

	it("sets variable with json domain", async () => {
		const feature = {
			path: "/features/d.feature",
			content: `set data as json to ${JSON.stringify({ a: 1 })}\nvariable data is ${JSON.stringify({ a: 1 })}`,
		};
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
		// ensure the variable was stored with domain json in world.shared
		expect((await res.world.shared.all()).data.domain).toBe("json");
		const value = await res.world.shared.get("data");
		expect(typeof value).toBe("object");
		expect(value).toEqual({ a: 1 });
	});

	it("Set number", async () => {
		const feature = { path: "/features/d.feature", content: "set Value as number to 4" };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);

		const stepVal = (await res.world.shared.all())["Value"];
		expect(stepVal).toBeDefined();
		expect(stepVal.domain).toBe("number");
		expect(stepVal.value).toBe("4");
		const value = await res.world.shared.get("Value");
		expect(typeof value).toBe("number");
		expect(value).toBe(4);
	});

	it("increment number and compare with is", async () => {
		const feature = {
			path: "/features/d.feature",
			content: "set counter as number to 0\nincrement counter\nvariable counter is 1",
		};
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});

	it("whenever loop increment and compare with is", async () => {
		const feature = {
			path: "/features/d.feature",
			content: "set counter as number to 0\nwhenever variable counter is less than 3, increment counter\nvariable counter is 3",
		};
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});

	it("fails on invalid json domain", async () => {
		const feature = { path: "/features/d.feature", content: 'set bad as json to "{"a":1"' }; // missing closing quote / brace
		const res = await failWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});

	describe("$ENV$ vars", () => {
		it("substitutes $TEST_VALUE$", async () => {
			const feature = { path: "/features/b.feature", content: "set fromEnv to $TEST_VALUE$" };
			const res = await passWithDefaults([feature], steppers, {
				options: { DEST: "default", envVariables: { TEST_VALUE: "ok" } },
				moduleOptions: {},
			});
			expect(res.ok).toBe(true);
			const check = await passWithDefaults([{ path: "/features/c.feature", content: 'set fromEnv to $TEST_VALUE$\nvariable "fromEnv" is "ok"' }], steppers, {
				options: { DEST: "default", envVariables: { TEST_VALUE: "ok" } },
				moduleOptions: {},
			});
			expect(check.ok).toBe(true);
		});
	});
});

describe("a persisted type's level property", () => {
	const persisted = (properties: Record<string, TPropertyDef>) =>
		toRegisteredDomain({
			selectors: ["note"],
			schema: PersistedVertexSchema.extend({ id: z.string(), generatedAtTime: z.string() }),
			description: "A note.",
			topology: { persistedAs: "Note", id: "id", properties: { id: LinkRelations.IDENTIFIER.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel, ...properties } },
		});

	it("is added where the type is registered, so no declaration repeats it", () => {
		expect((persisted({}).topology as THypermediaTopology).properties.accessLevel).toBe(LinkRelations.ACCESS_LEVEL.rel);
	});
});

describe("a reference to a record of a type", () => {
	it("is derived for each type a record persists as, one registered as a feature declares it included, and takes a record's id", () => {
		const RECIPE = "recipe";
		const world = getDefaultWorld();
		registerDomains(world, [
			[
				{
					selectors: [RECIPE],
					schema: z.object({ id: z.string() }),
					description: "a recipe",
					topology: { persistedAs: "Recipe", id: "id", properties: { id: LinkRelations.IDENTIFIER.rel } },
				},
			],
		]);
		const ref = world.domains[refDomainKey(RECIPE)];
		expect(refTargetOf(ref, world.domains)).toBe(RECIPE);
		expect(ref.schema.parse("hummus")).toEqual({ id: "hummus" });
	});
});

describe("a list a caller gives", () => {
	it("is an array, its JSON text or text separated by commas, and is refused naming nothing", () => {
		const { schema } = getDefaultWorld().domains[DOMAIN_ACTIONS];
		const READ_AND_RUN = ["Read:private", "Instance:run"];
		expect(schema.parse(READ_AND_RUN)).toEqual(READ_AND_RUN);
		expect(schema.parse(JSON.stringify(READ_AND_RUN))).toEqual(READ_AND_RUN);
		expect(schema.parse(" Read:private, Instance:run ")).toEqual(READ_AND_RUN);
		expect(schema.safeParse(" , ").success, "text naming no action").toBe(false);
		expect(schema.safeParse("[not json").success, "text opening as JSON that is none").toBe(false);
	});
});

describe("a step's place and a length of time", () => {
	it("reads a step's place from its sequence path or an id beginning with one, and refuses an id naming no step", () => {
		const { schema } = getDefaultWorld().domains[DOMAIN_STEP_PATH];
		expect(schema.parse("0.1.-5.3")).toEqual([0, 1, -5, 3]);
		expect(schema.parse("0.1.5.3.artifact.0"), "an event's id").toEqual([0, 1, 5, 3]);
		expect(schema.safeParse("artifact.0").error?.issues[0]?.message).toMatch(/names no step/);
	});

	it("reads seconds and milliseconds as milliseconds, and refuses a length given in no unit", () => {
		const { schema } = getDefaultWorld().domains[DOMAIN_DURATION];
		expect(schema.parse("2s")).toBe(2000);
		expect(schema.parse("30 ms")).toBe(30);
		expect(schema.safeParse("2 minutes").error?.issues[0]?.message).toMatch(/is no length of time/);
	});
});

describe("what a variable step writes", () => {
	it("reads a set's quoted members, or else its words, and refuses a set naming none", () => {
		const { schema } = getDefaultWorld().domains[DOMAIN_SET_VALUES];
		expect(schema.parse('"red wine", "gin"')).toEqual(["red wine", "gin"]);
		expect(schema.parse("red, green blue")).toEqual(["red", "green", "blue"]);
		expect(schema.safeParse(" , ").error?.issues[0]?.message).toMatch(/names no member/);
	});

	it("reads a hypermedia declaration trimmed, and refuses one declaring nothing", () => {
		const { schema } = getDefaultWorld().domains[DOMAIN_HYPERMEDIA_DECLARATION];
		expect(schema.parse("  id, with name ")).toBe("id, with name");
		expect(schema.safeParse("   ").error?.issues[0]?.message).toMatch(/declares nothing/);
	});

	it("compares a variable with a value of any domain, which the variable's domain reads", async () => {
		const set = 'set of colour is [red, green]\nset a as colour to "red"\nset b as colour to "red"\nset c as colour to "green"';
		expect((await passWithDefaults([{ path: "/features/v.feature", content: `${set}\nvariable a is {b}` }], steppers)).ok).toBe(true);
		await failWithDefaults([{ path: "/features/v.feature", content: `${set}\nvariable a is {c}` }], steppers);
	});
});
