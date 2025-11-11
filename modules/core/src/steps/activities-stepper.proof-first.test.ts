import { describe, it, expect } from 'vitest';
import { ActivitiesStepper } from './activities-stepper.js';
import { passWithDefaults } from '../lib/test/lib.js';
import VariablesStepper from './variables-stepper.js';
import Haibun from './haibun.js';

describe('activities-stepper proof-first execution', () => {
    it('should execute activity body when proof fails', async () => {
        const feature = `Feature: Activity body runs when proof fails

    Activity: Knows about data
        set myVariable to "fromActivity"
        waypoint Knows about data with variable myVariable is "fromActivity"

Scenario: Proof fails first time

The variable is not set, so the proof will fail and the activity body should run.

    ensure Knows about data

The activity body should have run and set the variable.

    variable myVariable is "fromActivity"
`;

        const result = await passWithDefaults(feature, [ActivitiesStepper, VariablesStepper, Haibun]);

        expect(result.ok).toBe(true);
    });

    it('should NOT execute activity body when proof already passes', async () => {
        const feature = `Feature: Proof already passes

    Activity: Knows about data
        set myVariable to "fromActivity"
        waypoint Knows about data with variable myVariable is "initialValue"

Scenario: Proof passes so activity body should not run

We set the variable to match the proof value.

    set myVariable to "initialValue"

We call ensure and the proof will pass immediately, so the activity body should NOT run.
The bug would cause myVariable to change to "fromActivity".

    ensure Knows about data
    variable myVariable is "initialValue"
`;

        const result = await passWithDefaults(feature, [ActivitiesStepper, VariablesStepper, Haibun]);

        if (!result.ok) {
            console.log('Test 2 failed:', result.failure);
        }
        expect(result.ok).toBe(true);
    });
    it('should prevent recursion when activity body contains waypoint', async () => {
        const feature = `Feature: No recursion when proof passes

    Activity: Recursive activity
        set counter to "1"
        waypoint Recursive activity with variable counter is "1"

Scenario: Waypoint in activity body should not recurse

The counter variable is not set, so the proof will fail and the activity body will run.
The activity body sets counter to 1, then hits the waypoint line which registers the outcome.
When the waypoint line executes, it should NOT trigger another execution of the activity body.

    ensure Recursive activity
    variable counter is "1"
`;

        const result = await passWithDefaults(feature, [ActivitiesStepper, VariablesStepper, Haibun]);

        expect(result.ok).toBe(true);
    });
});
