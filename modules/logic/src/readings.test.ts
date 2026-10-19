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
import { readEvery } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/actuality/domains/seq-path.js";

const STEPPERS = [Haibun, TestSteps, VariablesStepper, ActivitiesStepper];

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
	["existence over an observation source", "passes\nsome step observed in step usage is variable step/count is more than 0", true],
	["universal over an observation source", "passes\nevery stepper observed in stepper usage is variable stepper/count is more than 0", true],
	["a quoted statement under a quantifier is proved", 'passes\nsome step observed in step usage is "variable step/count is more than 999999"', false],
	["a quoted statement under every is proved", 'passes\nevery step observed in step usage is "variable step/count is more than 999999"', false],
	[
		"an item keeps its dots while its metrics resolve",
		'passes\nsome step observed in step usage is matches {step} with "*.*"\nsome step observed in step usage is variable step/count is more than 0',
		true,
	],
	[
		"the step usage source counts the records by step",
		'passes\npasses\npasses\nsome step observed in step usage is "variable step/count is more than 2"\nevery step observed in step usage is "variable step/count is less than 4"',
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
	it.each(READINGS)("%s", async (_, content, passes) => {
		const result = passes ? await passWithDefaults(content, STEPPERS) : await failWithDefaults(content, STEPPERS);
		expect(result.ok).toBe(passes);
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
