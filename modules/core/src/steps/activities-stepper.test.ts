import { describe, it, expect } from "vitest";

import { ActivitiesStepper } from "./activities-stepper.js";
import { getDefaultWorld, passWithDefaults } from "../lib/test/lib.js";
import VariablesStepper from "./variables-stepper.js";
import Haibun from "./haibun-stepper.js";
import { DOMAIN_WAYPOINT_ARGUMENT } from "../lib/domains/domains.js";
import { Resolver } from "../lib/actuality/pipelines/resolver.js";

describe("ActivitiesStepper", () => {
	/** An activities stepper set in a world, as a run sets it. */
	const activities = async (): Promise<ActivitiesStepper> => {
		const stepper = new ActivitiesStepper();
		await stepper.setWorld(getDefaultWorld(), [stepper]);
		return stepper;
	};
	const background = (lines: string[]): ConstructorParameters<typeof Resolver>[1][number] => ({
		base: "",
		name: "login",
		path: "/backgrounds/login.feature",
		content: lines.join("\n"),
	});

	describe("a waypoint's rule", () => {
		it("holds its head, its pattern, in which each placeholder that doesn't name a domain takes a waypoint argument, its proof, its activity and its line", async () => {
			const stepper = await activities();
			new Resolver([stepper], [background(["Activity: Log in", 'set loggedIn to "true"', 'waypoint Is logged in as {user} with variable loggedIn is "true"'])]);
			const source = { path: "/backgrounds/login.feature" };
			expect(stepper.steps.apply.rules()).toEqual([
				{
					head: "Is logged in as {user}",
					library: "/backgrounds/login.feature",
					pattern: `Is logged in as {user: ${DOMAIN_WAYPOINT_ARGUMENT}}`,
					proof: [{ in: 'variable loggedIn is "true"', source }],
					activity: [{ in: 'set loggedIn to "true"', source: { ...source, lineNumber: 2 } }],
					source: { ...source, lineNumber: 3 },
				},
			]);
		});

		it("applies in the feature that states it, so two features state the same head", async () => {
			const feature = (path: string) => ({ path, content: ["Activity: Set it", 'set it to "yes"', 'waypoint It is set with variable it is "yes"', "ensure It is set"].join("\n") });
			const result = await passWithDefaults([feature("/features/a.feature"), feature("/features/b.feature")], [VariablesStepper, ActivitiesStepper]);
			expect(result.ok, result.failure?.error?.message).toBe(true);
		});

		it("is refused where two lines state its head", async () => {
			const stepper = await activities();
			const twice = ["Activity: Log in", "waypoint Logged in", "Activity: Log in again", "waypoint Logged in"];
			expect(() => new Resolver([stepper], [background(twice)])).toThrow('the waypoint "Logged in" is stated at /backgrounds/login.feature:2 and at /backgrounds/login.feature:4');
		});
	});

	describe("ensure step", () => {
		const steppers = [VariablesStepper, ActivitiesStepper];

		it("should execute outcome on first ensure", async () => {
			const background = {
				path: "/backgrounds/test.feature",
				content: `Activity: Test
waypoint Task completed with set result to "done"`,
			};

			const feature = {
				path: "/features/test.feature",
				content: `set result to "initial"
ensure Task completed
variable result is "done"`,
			};

			const result = await passWithDefaults([feature], steppers, undefined, [background]);
			expect(result.ok).toBe(true);
		});

		it("should support ensure flows with slash-named variables", async () => {
			const steppersWithHaibun = [VariablesStepper, ActivitiesStepper, Haibun];
			const feature = {
				path: "/features/test.feature",
				content: `ordered set of client status is ["negotiating" "agreed"]

Activity: Engage a client
set {name}/signed as client status to "negotiating"
set {name}/popular as client status to "negotiating"
waypoint Engaged {name} with variable {name}/signed exists

Activity: Foster a client
increment {name}/{concern}
waypoint {name} is past negotiating on {concern} with variable {name}/{concern} is more than "negotiating"

Scenario: Dynamic domains
ensure Engaged "Le Artiste"
ensure "Le Artiste" is past negotiating on "signed"
variable Le Artiste/signed is "agreed"`,
			};

			const result = await passWithDefaults([feature], steppersWithHaibun);
			if (!result.ok) {
				throw result.failure?.error ?? new Error("ensure flow failed");
			}
			expect(result.ok).toBe(true);
		});

		it("binds a waypoint argument to the quoted text its placeholder matches, or to the value of the variable it refers to", async () => {
			const feature = {
				path: "/features/test.feature",
				content: `Activity: Greet a guest
set {who} greeted to "yes"
waypoint Greeted {who} with variable {who} greeted is "yes"

Scenario: Guests
ensure Greeted "Room 101"
variable Room 101 greeted is "yes"
set guest to "Ada"
ensure Greeted {guest}
variable Ada greeted is "yes"`,
			};
			const result = await passWithDefaults([feature], [VariablesStepper, ActivitiesStepper, Haibun]);
			expect(result.ok, result.failure?.error?.message).toBe(true);
		});

		it("reads an argument as its value where a variable has that value as its name, and reads that variable where the line names it in backticks", async () => {
			const feature = {
				path: "/features/test.feature",
				content: `Activity: Note a guest
set noted to {who}
set held to \`{who}\`
waypoint Noted {who} with variable noted is {who}

Scenario: Guests
set Ada to "another value"
ensure Noted "Ada"
variable noted is "Ada"
variable held is "another value"`,
			};
			const result = await passWithDefaults([feature], [VariablesStepper, ActivitiesStepper, Haibun]);
			expect(result.ok, result.failure?.error?.message).toBe(true);
		});
	});
});
