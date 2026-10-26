/**
 * Each reading the logic engine holds, with each verdict a line can end with: a table of lines and whether their feature
 * passes, and the path of each record a proof writes.
 */
import { describe, expect, it } from "vitest";
import { failWithDefaults, getDefaultWorld, passWithDefaults, testWithWorld, withLogic } from "@haibun/core/lib/test/lib.js";
import { UNTIL_RETRY_MS } from "./domains/readings.js";
import TestSteps from "@haibun/core/lib/test/TestSteps.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import { readEvery } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { AStepper, READING, untilWithoutDuration, type TStepperSteps } from "@haibun/core/lib/steps/domains/stepper.js";
import { DOMAIN_STATEMENT } from "@haibun/core/lib/domains/domains.js";

const STEPPERS = [Haibun, TestSteps, VariablesStepper, ActivitiesStepper];

/** A stepper that declares a step that reads as until without stating how long it proves its statements again. */
class UntilWithoutDuration extends AStepper {
	description = "Declares a step that reads as until without a duration";
	steps = { retry: { gwta: `retry {statements: ${DOMAIN_STATEMENT}}`, reading: READING.until } } as const satisfies TStepperSteps;
}

/** A line or lines, and whether their feature passes. */
const READINGS: [string, string, boolean][] = [
	["negation of a refuted call", "not fails", true],
	["negation of a proved call", "not passes", false],
	["negation of a line that doesn't resolve", "not doesnotexist", false],
	["double negation of a proved call", "not not passes", true],
	["double negation of a refuted call", "not not fails", false],
	["negation of a line that doesn't resolve below two negations", "not not who's there", false],
	["four negations of a proved call", 'set who to "there"\nnot not not not variable "who" is "there"', true],
	["negation of a set variable's existence", 'set wtw to 5\nnot variable "wtw" exists', false],
	["negation of an unset variable's existence", 'not variable "unset" exists', true],
	["implication with a refuted condition holds", 'not where variable "ghost" exists, passes', false],
	["implication with a proved condition and a proved action", 'set a to 1\nnot where variable "a" exists, passes', false],
	["implication with a proved condition and a refuted action", 'set a to 1\nnot where variable "a" exists, fails', true],
	["implication nested under an implication", 'set who to "there"\nwhere variable "who" is "there", where not variable "who" is "there", passes', true],
	["disjunction with a proved alternative", "any of fails, passes", true],
	["disjunction without a proved alternative", "any of fails, fails", false],
	["maybe holds whatever its statement's verdict", "maybe fails\nmaybe passes\nnot not maybe this line resolves to no step", true],
	["repetition with a condition that doesn't resolve", "whenever doesnotexist, ends with OK", false],
	["repetition with an action that doesn't resolve", "whenever passes, doesnotexist", false],
	["repetition whose action is refuted", "not whenever passes, fails", true],
	["repetition whose condition is refuted", "whenever not passes, fails", true],
	["repetition until its condition is refuted", 'whenever not variable "fresh" exists, set fresh to 1\nvariable "fresh" is "1"', true],
	["repetition that doesn't run its action", 'set existing to 2\nwhenever not variable "existing" exists, set existing to 3\nvariable "existing" is "2"', true],
	["repetition that doesn't run its refuted action", 'set existing to 2\nwhenever not variable "existing" exists, fails', true],
	["existence over a domain", 'set of numbers is [1, 2, 3]\nsome n in numbers is where set temp to {n}, variable temp is "2"', true],
	["existence over a domain without a match", "set of numbers is [1, 2, 3]\nnot some n in numbers is where set temp to {n}, variable temp is 4", true],
	["existence over an empty domain", "set of nothing as [string]\nnot some n in nothing is passes", true],
	["universal over an empty domain", "set of nothing as [string]\nevery n in nothing is fails", true],
	["universal over a domain with a refuted member", 'set of Meals is ["dinner", "lunch"]\nnot every meal in Meals is matches {meal} with "din*"', true],
	[
		"nested quantifiers",
		'set of Hosts is ["api.example.com"]\nset of Allowed is ["example.com"]\nevery host in Hosts is some domain in Allowed is matches {host} with "*{domain}"',
		true,
	],
	["a quantifier's variable doesn't stay set after it", 'set of Meals is ["dinner"]\nevery meal in Meals is passes\nnot variable meal exists', true],
	["existence over an observation source", 'passes\nsome step observed in steps is variable step/called is "TestSteps.passes"', true],
	["universal over an observation source", "passes\nevery step observed in steps is variable step/stepText exists", true],
	["a quoted statement under a quantifier is proved", 'passes\nsome step observed in steps is "variable step/duration is more than 999999"', false],
	["a quoted statement under every is proved", 'passes\nevery step observed in steps is "variable step/duration is more than 999999"', false],
	[
		"an item keeps its dots while its functions resolve",
		'passes\nsome step observed in steps is matches {step} with "*.*"\nsome step observed in steps is variable step/duration is less than 999999',
		true,
	],
	[
		"the steps source states each record's stepper and its duration",
		'passes\nsome step observed in steps is variable step/stepper is "TestSteps"\nevery step observed in steps is where variable step/called is "TestSteps.passes", variable step/duration is less than 1000',
		true,
	],
	[
		"a step's duration is a function of its record",
		'pause for 30ms\nevery step observed in steps is where variable step/called is "Haibun.pause", variable step/duration is more than 29',
		true,
	],
	[
		"a universal states a rule whose head a line proves where its body holds",
		'set of Meals is ["dinner", "lunch"]\nset dinner to "cooked"\nfor every {meal: Meals} where variable {meal} is "cooked", {meal} is edible\n"dinner" is edible\nnot "lunch" is edible',
		true,
	],
	[
		"a stated falsity refutes a goal, and a goal without one is unknown",
		'set of Meals is ["dinner", "lunch"]\nActivity: Prepare a meal\nwaypoint {meal: Meals} is raw\nabsent dinner is raw\nset dinner status from maybe ensure dinner is raw\nvariable dinner status.verdict is "refuted"\nset lunch status from maybe ensure lunch is raw\nvariable lunch status.verdict is "unknown"',
		true,
	],
	[
		"an individual stated the same as another is read as their canonical representative",
		'Activity: Prepare a meal\nwaypoint {meal} is raw\n"supper" is the same as "dinner"\nabsent "dinner" is raw\nset status from maybe ensure "supper" is raw\nvariable status.verdict is "refuted"',
		true,
	],
	["an observation source that isn't declared", "every x observed in unknown source is passes", false],
	["until holds once its statement holds", 'set ready to "yes"\nuntil variable ready is "yes" within 1s', true],
	["until is refuted where its statement doesn't hold in time", 'set ready to "yes"\nnot until variable ready is "never" within 300ms', true],
	[
		"ensure runs the activity where the proof is refuted",
		'Activity: Count\nset runs to "1"\nwaypoint Counted with variable runs is "1"\nensure Counted\nvariable runs is "1"',
		true,
	],
	["ensure is refuted where the activity doesn't prove the proof", 'Activity: Unset\nset left to "no"\nwaypoint It is set with variable left is "yes"\nnot ensure It is set', true],
	[
		"ensure binds a waypoint's placeholder",
		'Activity: Greet\nset greeted to {who}\nwaypoint Greeted {who} with variable greeted is {who}\nensure Greeted "Ada"\nvariable greeted is "Ada"',
		true,
	],
	["ensure of a line that isn't a waypoint", "not ensure passes", true],
	["a waypoint applied below itself with the same arguments is unknown", "Activity: Loop\nensure Looped\nwaypoint Looped with fails\nensure Looped", false],
];

describe("the readings of the logic engine", () => {
	it("returns from not why its statement didn't hold, as a refused call's error text and seqPath, which a feature that expects a failure matches", async () => {
		const refusal = await passWithDefaults('set refusal from not fails\nvariable refusal.refusal is "test fail"\nmatches refusal.seqPath with "*.*"', STEPPERS);
		expect(refusal.ok, "not's products").toBe(true);
		const thrown = await passWithDefaults('set thrown from not throw an exception\nmatches thrown.refusal with "the step threw: *"', STEPPERS);
		expect(thrown.ok, "a thrown error's message").toBe(true);
		const differs = await failWithDefaults('set refusal from not fails\nmatches refusal.refusal with "*isn\'t permitted*"', STEPPERS);
		expect(differs.ok, "a refusal other than the expected error").toBe(false);
	});

	it.each(READINGS)("%s", async (_, content, passes) => {
		const result = passes ? await passWithDefaults(content, STEPPERS) : await failWithDefaults(content, STEPPERS);
		expect(result.ok).toBe(passes);
	});

	it("reads the items of an observation source under what holding only holds, and refuses a read above it with the read to request", async () => {
		const content = 'passes\nholding only "LogicStepper:everyObserved,VariablesStepper:matches", every step observed in steps is matches {step} with "*"';
		const result = await failWithDefaults(content, [...STEPPERS, AuthorityStepper]);
		expect(result.failure?.error.message).toContain("request Read:public from a key that delegates it");
	});

	it("fails a goal both proved and stated absent as a contradiction, naming the record of each", async () => {
		const content =
			'Activity: Serve dinner\nset served to "yes"\nwaypoint Dinner is served with variable served is "yes"\nset served to "yes"\nabsent Dinner is served\nensure Dinner is served';
		const result = await failWithDefaults(content, STEPPERS);
		expect(result.failure?.error.message).toMatch(/`Dinner is served` is contradiction: the record \S+\.0\.1\.0\.2 states it is absent, and its proof at \S+\.0\.1\.0\.3\.1 holds/);
	});

	it("refuses a line that reads as until without a duration where it resolves, naming the line, rather than end actuality at its first wait", async () => {
		const result = await failWithDefaults("retry fails", [...STEPPERS, UntilWithoutDuration]);
		expect(result.failure?.stage).toBe("Resolve");
		expect(result.failure?.error.message).toContain(untilWithoutDuration("retry fails"));
	});

	it("ends until at its deadline, however many attempts the deadline allows", async () => {
		const world = getDefaultWorld({ HAIBUN_LOG_LEVEL: "none" });
		let now = 0;
		world.clock = { ...world.clock, now: () => now, wait: (ms) => Promise.resolve(void (now += ms)) };
		const withinMs = 1500 * UNTIL_RETRY_MS;
		const result = await testWithWorld(world, `until variable ready is "never" within ${withinMs}ms`, await withLogic(STEPPERS));
		expect(result.failure?.error.message).toContain(`didn't hold within ${withinMs}ms`);
	});

	it("proves a statement under a line, each part of the proof at its position", async () => {
		const result = await passWithDefaults('set who to "there"\nwhere variable "who" is "there", not not variable "who" is "there"', STEPPERS);
		expect(result.ok).toBe(true);
		const records = await readEvery(result.world.shared.getStore(), { label: SEQ_PATH_LABEL });
		const lines = records
			.filter((record) => String(record[SEQ_PATH_FIELD.id]).includes(".0.1.0.2"))
			.map((record) => [String(record[SEQ_PATH_FIELD.id]).split(".0.1.0.2")[1], record[SEQ_PATH_FIELD.verdict]]);
		expect(lines.sort()).toEqual([
			["", "proved"],
			[".1", "proved"],
			[".2", "proved"],
			[".2.1", "refuted"],
			[".2.1.1", "proved"],
		]);
	});
});
