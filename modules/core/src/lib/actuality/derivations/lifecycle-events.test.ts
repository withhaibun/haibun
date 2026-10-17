/** A step's lifecycle events obscure a secret variable's value by its name, and state an error only where the step failed. */
import { describe, expect, it } from "vitest";
import type { TFeatureStep } from "../../steps/domains/stepper.js";
import { OBSCURED_VALUE } from "../../steps/domains/secrets.js";
import { STATUS } from "../../../schema/protocol.js";
import { executionEvent, featureEvent, scenarioEvent, stepEndEvent, stepStartEvent } from "./lifecycle-events.js";

// The step is partial, so it is cast through unknown to TFeatureStep.
const featureStep = { source: { path: "/test/feature.ts", lineNumber: 1 }, in: 'set password to "secret123"', seqPath: [1, 1, 1] } as unknown as TFeatureStep;
const called = (stepValuesMap: Record<string, unknown> | undefined) => ({ stepperName: "VariablesStepper", actionName: "set", stepValuesMap });
const valuesOf = (event: unknown) => (event as { stepValuesMap?: Record<string, unknown> }).stepValuesMap;

describe("a step's lifecycle events", () => {
	it("obscure the value of a variable whose name marks it secret, at the start and at the end", () => {
		const values = {
			password: { term: "password", value: "secret123", domain: "string", origin: "var" },
			username: { term: "username", value: "testuser", domain: "string", origin: "var" },
		};
		for (const event of [
			stepStartEvent(featureStep, called(values), false, 1),
			stepEndEvent(featureStep, called(values), { status: STATUS.completed, error: undefined, products: undefined }, 2),
		]) {
			expect(valuesOf(event)).toEqual({ password: { ...values.password, value: OBSCURED_VALUE }, username: values.username });
		}
	});

	it("obscure a value held as text, and leave out the values of a step that doesn't state any", () => {
		expect(valuesOf(stepStartEvent(featureStep, called({ password: "secret123", username: "testuser" }), false, 1))).toEqual({ password: OBSCURED_VALUE, username: "testuser" });
		expect(valuesOf(stepStartEvent(featureStep, called(undefined), false, 1))).toBeUndefined();
	});

	it("state the error of a step that failed, and don't state one for a step that completed, so a view doesn't show one", () => {
		const failed = stepEndEvent(featureStep, called(undefined), { status: STATUS.failed, error: new Error("the variable isn't set"), products: undefined }, 2);
		const completed = stepEndEvent(featureStep, called(undefined), { status: STATUS.completed, error: undefined, products: undefined }, 2);
		expect(failed).toMatchObject({ id: "1.1.1", stage: "end", status: STATUS.failed, error: "the variable isn't set" });
		expect((completed as { error?: unknown }).error).toBeUndefined();
	});
});

describe("a level's lifecycle events", () => {
	it("share an id at the start and the end, and state running at the start and how the level ended at the end", () => {
		const feature = { path: "/features/a.feature", name: "a" };
		expect([featureEvent(1, feature, { stage: "start" }, 1), featureEvent(1, feature, { stage: "end", status: STATUS.failed }, 2)]).toMatchObject([
			{ id: "feat-1", type: "feature", stage: "start", status: STATUS.running, featurePath: feature.path, featureName: "a" },
			{ id: "feat-1", type: "feature", stage: "end", status: STATUS.failed },
		]);
		expect(scenarioEvent(1, 2, "signs in", { stage: "end", status: STATUS.completed }, 3)).toMatchObject({
			id: "feat-1.scen-2",
			scenarioName: "signs in",
			status: STATUS.completed,
		});
		expect([executionEvent({ stage: "start" }, 4, "/tests"), executionEvent({ stage: "end", status: STATUS.completed }, 5)]).toMatchObject([
			{ id: "execution", type: "execution", status: STATUS.running, in: "/tests" },
			{ id: "execution", type: "execution", status: STATUS.completed },
		]);
	});
});
