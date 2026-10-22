import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";

/** The heads of the test runner's waypoints, which a feature states and each waypoint below declares. */
export const testRuns = {
	pass: (where: string, seconds: string) => `the tests in ${where} pass within ${seconds} seconds`,
};

export const backgrounds: TKirejiExport = {
	"Test runs": [
		"The tests of a base pass where a test run of every feature in it ends passed within the seconds a feature states. A test run that doesn't pass fails the wait with its last output.",
		"Activity: Run the tests of a base to their end",
		"run all the tests in {where}",
		"wait until the test run ends within {seconds} seconds",
		`waypoint ${testRuns.pass("{where}", "{seconds}")}`,
	],
};
