import { describe, expect, it } from "vitest";

import { DEF_PROTO_OPTIONS, getTestWorldWithOptions, testWithWorld } from "../lib/test/lib.js";
import VariablesStepper from "./variables-stepper.js";
import Haibun from "./haibun.js";
import { OBSCURED_VALUE } from "../lib/steps/domains/secrets.js";
import { SHARED_GRAPH } from "../lib/actuality/pipelines/feature-variables.js";
import { readFacts } from "../lib/records/pipelines/facts.js";
import { readEvery } from "../lib/records/pipelines/record-reads.js";
import { VARIABLE_FIELD } from "../lib/records/domains/variables.js";
import { Access, SEQ_PATH_LABEL } from "../lib/resources.js";
import type { THaibunEvent } from "../schema/protocol.js";

const SECRET = "pg-pass-456";
const SECRET_ENV = "DB_PASSWORD";
/** A variable named as a secret. */
const NAMED = "dbPassword";
/** A variable that holds a secret through interpolation. */
const HELD = "held";
/** A variable composed from a variable that holds a secret. */
const BUILT = "built";
const SECRET_VARIABLES = [NAMED, HELD, BUILT];
const PER_TYPE_LIMIT = 100;

const SET_SECRETS = [`set ${NAMED} to ${SECRET_ENV}`, `set ${HELD} to "{${NAMED}}"`, `compose ${BUILT} with {${HELD}}`];
const SHOW_SECRETS = SECRET_VARIABLES.map((name) => `show var ${name}`);

const holdsSecret = (read: unknown) => JSON.stringify(read).includes(SECRET);

async function runWithSecrets(lines: string[]) {
	const world = getTestWorldWithOptions({ ...DEF_PROTO_OPTIONS, options: { ...DEF_PROTO_OPTIONS.options, envVariables: { [SECRET_ENV]: SECRET } } });
	const events: THaibunEvent[] = [];
	world.eventLogger.subscribe((event) => events.push(event));
	const ran = await testWithWorld(world, lines.join("\n"), [VariablesStepper, Haibun]);
	const store = ran.world.shared.getStore();
	const stepRecords = await store.query({ namedGraph: SEQ_PATH_LABEL });
	return { ran, store, events, stepRecords };
}

describe("a secret variable's value", () => {
	it("doesn't reach the variables graph, the clustered sample, the events, the facts or the step records", async () => {
		const { ran, store, events, stepRecords } = await runWithSecrets([...SET_SECRETS, ...SHOW_SECRETS]);
		expect(ran.ok).toBe(true);

		const variables = await readEvery(store, { label: SHARED_GRAPH });
		expect(variables.map((record) => [record[VARIABLE_FIELD.name], record[VARIABLE_FIELD.value], record[VARIABLE_FIELD.secret]]).sort()).toEqual(
			SECRET_VARIABLES.map((name) => [name, OBSCURED_VALUE, true]).sort(),
		);
		expect.soft(holdsSecret(variables), "the variables graph holds the obscured value").toBe(false);

		const sample = await store.getClusteredQuads?.({ perTypeLimit: PER_TYPE_LIMIT, accessLevel: Access.private });
		expect(new Set(sample?.quads.filter((q) => q.namedGraph === SHARED_GRAPH).map((q) => q.subject))).toEqual(new Set(SECRET_VARIABLES));
		expect.soft(holdsSecret(sample), "the clustered sample at the private level holds the obscured value").toBe(false);

		expect(events.length).toBeGreaterThan(0);
		expect.soft(holdsSecret(events), "the emitted observations and lifecycle events hold the obscured value").toBe(false);

		const facts = await readFacts(store);
		expect(facts).toHaveLength(SHOW_SECRETS.length);
		expect.soft(holdsSecret(facts), "the facts of show var hold the obscured value").toBe(false);

		expect.soft(holdsSecret(stepRecords), "the step records hold the obscured value").toBe(false);
	});

	it("show var returns the obscured value", async () => {
		const { ran } = await runWithSecrets([...SET_SECRETS, ...SHOW_SECRETS]);
		const shown = ran.featureResults?.[0]?.stepResults.filter((s) => s.in.startsWith("show var")).map((s) => s.products?.value);
		expect(shown).toEqual(SECRET_VARIABLES.map(() => OBSCURED_VALUE));
	});

	it("variable … is compares the value", async () => {
		const { ran } = await runWithSecrets([...SET_SECRETS, ...SECRET_VARIABLES.map((name) => `variable ${name} is ${SECRET_ENV}`)]);
		expect(ran.ok).toBe(true);
	});

	it("a scenario reads the value a secret held in the scenario before it", async () => {
		const { ran } = await runWithSecrets([
			"Scenario: set the secrets",
			...SET_SECRETS,
			"Scenario: compare the secrets",
			...SECRET_VARIABLES.map((name) => `variable ${name} is ${SECRET_ENV}`),
		]);
		expect(ran.ok).toBe(true);
	});

	it("a failed comparison's step end holds the obscured value", async () => {
		const { ran, events, stepRecords } = await runWithSecrets([...SET_SECRETS, `variable ${BUILT} is "other"`]);
		expect(ran.ok).toBe(false);
		expect.soft(ran.failure?.error.message).toContain(OBSCURED_VALUE);
		expect.soft(holdsSecret(ran.failure), "the failure holds the obscured value").toBe(false);
		expect.soft(holdsSecret(events), "the step's end event holds the obscured value").toBe(false);
		expect.soft(holdsSecret(stepRecords), "the step's end record holds the obscured value").toBe(false);
	});
});
