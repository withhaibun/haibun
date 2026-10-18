import { it, expect, describe } from "vitest";

import { DEF_PROTO_OPTIONS, failWithDefaults, getTestWorldWithOptions, passWithDefaults } from "../lib/test/lib.js";
import VariablesStepper from "./variables-stepper.js";
import { DEFAULT_DEST, Origin } from "../lib/domains/protocol.js";
import Haibun from "./haibun.js";
import LogicStepper from "./logic-stepper.js";
import { OBSCURED_VALUE } from "../lib/steps/domains/secrets.js";
import { SHARED_GRAPH } from "../lib/actuality/pipelines/feature-variables.js";
import { recordWithEdges } from "../lib/records/pipelines/record-reads.js";
import { readFacts } from "../lib/records/pipelines/facts.js";
import { Access, EDGE, FACT_LABEL, SEQ_PATH_LABEL } from "../lib/resources.js";
import { readAction } from "../lib/actions.js";
import { SEQ_PATH_FIELD } from "../lib/actuality/domains/seq-path.js";
import EventCollectorStepper from "../lib/test/EventCollectorStepper.js";
import { dispatchStep } from "../lib/actuality/pipelines/step-dispatch.js";
import { buildFeatureStepForTransport } from "../lib/steps/pipelines/call-step.js";
import { StepRegistry } from "../lib/steps/pipelines/step-registry.js";
import { addStepperConcerns } from "../lib/actuality/pipelines/executor.js";
import { typeCollectionRemedy } from "../lib/domains/typed-links.js";

const steppers = [VariablesStepper, Haibun, LogicStepper];

describe("vars", () => {
	it("assigns", async () => {
		const content = 'set x to "1"\nshow var x\nvariable x is "1"';
		const res = await passWithDefaults(content, steppers);

		expect(res.ok).toBe(true);
	});
	it("tracks provenance", async () => {
		const content = 'set x to "1"\nset x to "2"';
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
		const all = await res.world.shared.all();
		expect(all.x?.origin, "a variable a step sets is a variable").toBe(Origin.var);
	});
	it("empty does not overwrite", async () => {
		const content = 'set empty x to "y"\nset empty x to "z"\nvariable x is "y"';
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it("a set variable exists", async () => {
		const content = 'set x to "y"\nvariable x exists';
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});

	it('does not obscure variable by name when only its value contains "secret"', async () => {
		const content = 'set snake value/path to "ISECRET_snake"\nshow var snake value/path';
		const envVariables = { SNAKE_CASE_PASSWORD: "ISECRET_snake" };
		const res = await passWithDefaults(content, [EventCollectorStepper, ...steppers], { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(res.ok).toBe(true);
		const showStep = res.featureResults?.[0]?.stepResults?.find((s) => s.in?.includes("show var"));
		expect(showStep?.products?._summary).toContain("ISECRET_snake");
		expect(showStep?.products?._summary).not.toContain(OBSCURED_VALUE);
	});

	it('does not obscure variable when only its value contains "password"', async () => {
		const content = 'set login hint to "Enter password"\nshow var login hint';
		const envVariables = { DATABASE_PASSWORD: "db-secret-123" };
		const res = await passWithDefaults(content, [EventCollectorStepper, ...steppers], { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(res.ok).toBe(true);
		const showStep = res.featureResults?.[0]?.stepResults?.find((s) => s.in?.includes("show var"));
		expect(showStep?.products?._summary).toContain("Enter password");
		expect(showStep?.products?._summary).not.toContain(OBSCURED_VALUE);
	});

	it("does not treat complex names as literals for exists", async () => {
		const content = "variable feature/path value-1 exists";
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
		expect(res.failure?.error?.message).toContain("the variable feature/path value-1 isn't set");
	});
});

describe("random vars", () => {
	it("cannot overwrite read-only variable", async () => {
		const content = 'set x as read-only string to "1"\nset x to "2"';
		const result = await failWithDefaults(content, [VariablesStepper]);
		expect(result.ok).toBe(false);
		expect(result.failure?.error?.message).toContain('the variable x isn\'t set: the variable "x" is read-only; set a variable of another name');
	});

	it("auto-detects password in variable name as secret", async () => {
		const content = 'set dbPassword to "pg-pass-456"';
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
		expect(res.world.shared.isSecret("dbPassword")).toBe(true);
	});

	it("masks stored variable copied from env secret name unless secure flag is used", async () => {
		const content = "set apiPassword to API_PASSWORD\nvariable apiPassword is API_PASSWORD";
		const envVariables = { API_PASSWORD: "secret-123" };
		const res = await passWithDefaults(content, steppers, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(res.ok).toBe(true);
		expect(await res.world.shared.get("apiPassword", true)).toBe("secret-123");
		expect(await res.world.shared.get("apiPassword")).toBe(OBSCURED_VALUE);
	});

	it("propagates secret flag through compose", async () => {
		const content = "set apiPassword to API_PASSWORD\ncompose token with {apiPassword}\nshow var token";
		const envVariables = { API_PASSWORD: "secret-123" };
		const res = await passWithDefaults(content, [EventCollectorStepper, ...steppers], { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(res.ok).toBe(true);
		expect(await res.world.shared.get("token", true)).toBe("secret-123");
		expect(await res.world.shared.get("token")).toBe(OBSCURED_VALUE);
		const showStep = res.featureResults?.[0]?.stepResults?.find((s) => s.in?.includes("show var"));
		expect(showStep?.products?._summary).toContain(OBSCURED_VALUE);
		expect(showStep?.products?._summary).not.toContain("secret-123");
	});

	it("assigns random", async () => {
		const content = "set r to 70 random characters";
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
		const v = await res.world.shared.get("r");
		expect(v).toBeDefined();
		expect((v as string).length).toBe(70);
	});
	it("does not assigns empty random", async () => {
		const content = "set r to 1\nset empty r to 70 random characters";
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
		const v = await res.world.shared.get("r");
		expect(v as string).toBe("1");
	});
	it("assigns empty random", async () => {
		const content = "set empty r to 70 random characters";
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
		const v = await res.world.shared.get("r");
		expect((v as string).length).toBe(70);
	});
});

describe("variable name literal handling", () => {
	it("set fails if literal name collides with env", async () => {
		const content = 'set what to "value"';
		const envVariables = { what: "ENV" };
		const { ok } = await failWithDefaults(content, steppers, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(ok).toBe(false);
	});
	it("compose fails if literal name collides with env", async () => {
		const content = 'set a to "A"\nset b to "B"\ncompose what with {a}{b}';
		const envVariables = { what: "ENV" };
		const { ok } = await failWithDefaults(content, steppers, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(ok).toBe(false);
	});
});

describe("vars between scenarios", () => {
	it("persists variables between scenarios", async () => {
		const content = `
Scenario: Scenario 1
set a to 1
variable a is "1"
Scenario: Scenario 2
variable a is "1"
`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
});

describe("the records of variables and facts", () => {
	const SET_FIRST = 'set a to "1"';
	const SET_SECOND = 'set a to "2"';
	const SHOW = "show var a";
	/** The text of each step a record's `wasGeneratedBy` edges reach. */
	const generatedBy = (read: Awaited<ReturnType<typeof recordWithEdges>>) =>
		(read?.edges ?? []).filter(({ type }) => type === EDGE.wasGeneratedBy).map(({ target }) => [target["@type"], target[SEQ_PATH_FIELD.stepText]]);

	it("link a variable's record to each step that set it, and a fact's record to the step that produced it", async () => {
		const res = await passWithDefaults([SET_FIRST, SET_SECOND, SHOW].join("\n"), steppers);
		expect(res.ok).toBe(true);
		if (!res.world) throw new Error("the feature's result doesn't hold its world");
		const store = res.world.shared.getStore();
		expect(generatedBy(await recordWithEdges(store, SHARED_GRAPH, "a"))).toEqual([
			[SEQ_PATH_LABEL, SET_FIRST],
			[SEQ_PATH_LABEL, SET_SECOND],
		]);
		const [fact, ...others] = await readFacts(store);
		if (!fact) throw new Error("working memory doesn't hold the fact of show var");
		expect(others).toEqual([]);
		expect(generatedBy(await recordWithEdges(store, FACT_LABEL, fact.id))).toEqual([[SEQ_PATH_LABEL, SHOW]]);
	});
});

describe("vars between features", () => {
	it("clears variables between features", async () => {
		const feature = { path: "/features/test.feature", content: 'set x to "y"' };
		const anotherFeature = { path: "/features/verify.feature", content: "not variable x exists" };
		const res = await passWithDefaults([feature, anotherFeature], steppers);

		expect(res.ok).toBe(true);
	});
	it("sees env vars between features", async () => {
		const content = 'variable b is "1"\nvariable b is "1"';
		const envVariables = { b: "1" };
		const res = await passWithDefaults(content, steppers, { options: { envVariables, DEST: DEFAULT_DEST }, moduleOptions: {} });
		expect(res.ok).toBe(true);
	});
});

describe("feature variables", () => {
	it("keeps pre-scenario feature variables", async () => {
		const content = 'set x to "y"\nScenario: Checks x\nvariable x is "y"';
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it("persists scenario variable changes to next scenario", async () => {
		const content = 'set x to "y"\nScenario: Sets x\nvariable x is "y"\nset x to "z"\nScenario: Checks x\nvariable x is "z"';
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
});

describe("vars between scenarios", () => {
	it("should persist variables across scenarios", async () => {
		const content = `set feature variable to "something"

Scenario: Check the variable and set it

variable feature variable is "something"

set feature variable to "something else"

Scenario: Make sure it persisted from previous scenario

variable feature variable is "something else"
`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
});

describe("a value a dot path reads from JSON", () => {
	const HELD = `set read as json to ${JSON.stringify({ total: 3, names: ["alpha", "beta"] })}`;
	const run = (lines: string[]) => ({ path: "/features/test.feature", content: [HELD, ...lines].join("\n") });
	const steppers = [Haibun, VariablesStepper];

	it("compares a number as a number", async () => {
		expect((await passWithDefaults([run(["variable read.total is 3", "variable read.total is more than 2"])], steppers)).ok).toBe(true);
	});
	it("matches a list where one of its items matches, and doesn't equal one of its items", async () => {
		expect((await passWithDefaults([run(['matches read.names with "beta"', 'matches read.names with "*lph*"'])], steppers)).ok).toBe(true);
		expect((await failWithDefaults([run(['matches read.names with "gamma"'])], steppers)).ok).toBe(false);
		expect((await failWithDefaults([run(['matches read.names with "*alpha,beta*"'])], steppers)).ok).toBe(false);
		expect((await failWithDefaults([run(['variable read.names is "beta"'])], steppers)).ok).toBe(false);
	});
});

describe("less than comparisons", () => {
	it("compares numeric variables", async () => {
		const content = `set counter as number to 5
variable counter is less than 7
not variable counter is less than 5
`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it("fails for invalid numeric comparisons", async () => {
		const content = `set counter to 10
variable counter is less than 5`;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
	it("does not compare string variables lexically", async () => {
		const content = `set name to "Alice"
variable name is less than "Bob"`;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
});

describe("more than comparisons", () => {
	it("compares numeric variables", async () => {
		const content = `set counter as number to 5
variable counter is more than 3
not variable counter is more than 5`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it("fails for invalid numeric comparisons", async () => {
		const content = `set counter to 10
variable counter is more than 5`;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
	it("does not compare string variables lexically", async () => {
		const content = `set name to "Alice"
variable name is more than "Bob"`;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
	it("compares using ordered domains", async () => {
		const content = `ordered set of phase is ["required" "started" "finished"]
set point as phase to "started"
variable point is more than "required"
not variable point is more than "started"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
});

describe("magnitude domains and comparisons", () => {
	it("supports defining magnitude domains for less than", async () => {
		const content = `ordered set of priority is ["low" "medium" "high"]
set priority as priority to "low"
variable priority is less than "high"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it("supports defining magnitude domains for not less than", async () => {
		const content = `ordered set of priority is ["low" "medium" "high"]
set priority as priority to "low"
not variable priority is less than "low"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it("supports defining magnitude domains for more than", async () => {
		const content = `ordered set of priority is ["low" "medium" "high"]
set priority as priority to "medium"
variable priority is more than "low"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it("supports defining magnitude domains for not more than", async () => {
		const content = `ordered set of priority is ["low" "medium" "high"]
set priority as priority to "medium"
not variable priority is more than "medium"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it("fails for invalid magnitude comparisons", async () => {
		const content = `ordered set of priority is ["low" "medium" "high"]
set priority as priority to "low"
not variable priority is more than "low"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it("fails for invalid magnitude comparisons", async () => {
		const content = `ordered set of phase is ["required" "started" "finished"]
set point as phase to "finished"
variable point is less than "finished"`;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
});

describe("enum domains", () => {
	it("registers enum domains and coerces values", async () => {
		const content = `set of traffic is ["red" "yellow" "green"]
set light as traffic to "red"
variable light is "red"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});

	it("prevents less than comparisons on unordered enums", async () => {
		const content = `set of decision is [yes no]
set choice as decision to yes
variable choice is less than no`;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
});

describe("enum superdomains", () => {
	it("refuses a set whose superdomain isn't registered, and states what failed and why", async () => {
		const res = await failWithDefaults("set of derived as [missingSuperdomain]", steppers);
		expect(res.ok).toBe(false);
		expect(res.failure?.error?.message).toContain(`the set of "derived" isn't registered from its superdomains: the set of derived names the domain "missingSuperdomain"`);
	});
});

describe("a set's refusal", () => {
	it("refuses a set whose values aren't stated, and states what failed and why", async () => {
		const res = await failWithDefaults("set of empty is []", steppers);
		expect(res.ok).toBe(false);
		expect(res.failure?.error?.message).toContain(`the set of "empty" isn't registered from its values: `);
	});

	it("refuses a hypermedia declaration that its schema rejects, and states what failed and why", async () => {
		const res = await failWithDefaults(`set of Recipe by ${JSON.stringify({ "@context": 3 })}`, steppers);
		expect(res.ok).toBe(false);
		expect(res.failure?.error?.message).toContain(`the set of "Recipe" isn't registered from its declaration: @context: `);
	});

	it("refuses a value that its domain rejects, with the domain to open as its remedy", async () => {
		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		const variables = new VariablesStepper();
		const callers = [variables];
		await variables.setWorld(world, callers);
		addStepperConcerns(world, callers);
		const registry = new StepRegistry(callers, world);
		const tool = registry.get(`${VariablesStepper.name}-setAs`);
		if (!tool) throw new Error("setAs isn't registered");
		const call = buildFeatureStepForTransport(tool, { what: "count", domain: "number", value: "many" }, [0, 1]);
		const result = await dispatchStep({ registry, world, steppers: callers, grantedCapability: [tool.descriptor.capability, readAction(Access.public)] }, call);
		expect(result).toMatchObject({ ok: false, remedy: typeCollectionRemedy("number") });
		expect(result.errorMessage).toContain("the domain number rejects the value of count: ");
		expect(result.errorMessage).toContain("Set a value the domain takes");
	});
});

describe("superdomain base and mixed types", () => {
	it("supports derived domains from base types", async () => {
		const content = `
set of textValues as [string]
set headline as textValues to "Hello"
variable headline is "Hello"
`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});

	it("supports mixing enums with base domain schemas", async () => {
		const content = `set of palette is ["sun" "moon"]
set of blendedSuper as [palette string]
set shade as blendedSuper to "anything"
variable shade is "anything"
set shade as blendedSuper to "sun"
variable shade is "sun"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
});

describe("isSet", () => {
	it("passes when variable exists", async () => {
		const content = `set setVar to "value"
variable setVar exists`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it("fails when variable is not set", async () => {
		const content = `variable unsetVar exists`;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
	it("names the fields a value has where a dot path names one it doesn't have", async () => {
		const content = `set snap as json to {"highlighted": 1, "follow": false}
variable snap.hilighted is "1"`;
		const res = await failWithDefaults(content, steppers);
		expect(res.failure?.error.message).toBe("snap doesn't have hilighted; it has highlighted, follow");
	});
	it("refuses an argument that reads a field a variable doesn't have, and states the fields it has", async () => {
		const content = `set snap as json to {"highlighted": 1, "follow": false}
set copy to snap.hilighted`;
		const res = await failWithDefaults(content, steppers);
		expect(res.failure?.error.message).toBe("step VariablesStepper.set: {value}: snap doesn't have hilighted; it has highlighted, follow. Quote it to pass it as a literal.");
	});
	it("takes a dotted term as a literal where it is quoted", async () => {
		const content = `set snap as json to {"highlighted": 1}
set quoted to "snap.hilighted"
variable quoted is "snap.hilighted"`;
		expect((await passWithDefaults(content, steppers)).ok).toBe(true);
	});
	it.each(["file.json", "/api/items", "https://example.com/a", "did:web:example.com"])("refuses an unquoted %s, which doesn't name a variable", async (term) => {
		const res = await failWithDefaults(`set named to ${term}`, steppers);
		expect(res.failure?.error.message).toContain(`${term} doesn't name a variable or an environment variable. Quote it to pass it as a literal.`);
	});
	it("passes when variable is in env", async () => {
		const content = `variable "fromenv" exists`;
		const envVariables = { fromenv: "1" };
		const res = await passWithDefaults(content, steppers, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(res.ok).toBe(true);
	});
	it("set uses env variable value when available", async () => {
		const content = `set x to fromenv
variable x is "1"`;
		const envVariables = { fromenv: "1" };
		const res = await passWithDefaults(content, steppers, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(res.ok).toBe(true);
	});
});

describe("matches with brace-bearing text", () => {
	it("a value containing a literal {X} matches a brace-free pattern", async () => {
		const content = 'set reply to "the {StepperName} echoed"\nmatches reply with "the * echoed"';
		expect((await passWithDefaults(content, steppers)).ok).toBe(true);
	});
	it("a pattern containing a literal {X} matches the same literal", async () => {
		const content = 'set reply to "the {StepperName} echoed"\nmatches reply with "the {StepperName} echoed"';
		expect((await passWithDefaults(content, steppers)).ok).toBe(true);
	});
	it("a resolvable {var} in the pattern still resolves", async () => {
		const content = 'set who to "Ada"\nset reply to "hello Ada"\nmatches reply with "hello {who}"';
		expect((await passWithDefaults(content, steppers)).ok).toBe(true);
	});
	it("a wrong match still fails", async () => {
		const content = 'set reply to "the {StepperName} echoed"\nmatches reply with "totally different"';
		expect((await failWithDefaults(content, steppers)).ok).toBe(false);
	});
});

describe("a transport's call", () => {
	it("sets a variable from the value in the call's input, as it does from a line", async () => {
		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		const variables = new VariablesStepper();
		const callers = [variables];
		await variables.setWorld(world, callers);
		addStepperConcerns(world, callers);
		const registry = new StepRegistry(callers, world);
		const tool = registry.get(`${VariablesStepper.name}-set`);
		if (!tool) throw new Error("set isn't registered");
		const call = buildFeatureStepForTransport(tool, { what: "greeting", value: "hi" }, [0, 1]);
		const result = await dispatchStep({ registry, world, steppers: callers, grantedCapability: [tool.descriptor.capability, readAction(Access.public)] }, call);
		expect(result.ok, result.errorMessage).toBe(true);
		expect(await world.shared.get("greeting")).toBe("hi");
	});
});
