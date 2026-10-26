/**
 * shu's views driven through web-playwright's steps alone. A shu source doesn't import a page driver and doesn't wait for a
 * length of time, a view's inspect() is called only by the view's own code, and each activity of the waypoints of shu's
 * views calls only core's and web-playwright's steps. A file holds each finding at most as often as view-steps.baseline.json
 * records.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectWithinBaseline, REPOSITORY_SCAN_MS, type TFound } from "@haibun/core/lib/test/baseline.js";
import { importsOf, parsedSource, sourceFiles, TEST_MODULE } from "@haibun/core/lib/test/repository-files.js";
import { asExpandedFeatures } from "@haibun/core/lib/test/resolver-features.js";
import { createSteppers } from "@haibun/core/lib/domains/util.js";
import { Resolver } from "@haibun/core/lib/actuality/pipelines/resolver.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import WebPlaywright from "@haibun/web-playwright";
import { backgrounds } from "../waypoints/backgrounds/views.feature.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const SHU_SOURCE = "modules/shu/src";
/** The code of shu's views, which alone calls a view's inspect(). */
const VIEW_CODE = "modules/shu/src/page/";
const TEST_FILE = "modules/shu/src/view-steps.test.ts";
const BASELINE = join(import.meta.dirname, "view-steps.baseline.json");
/** The page driver web-playwright holds, and its own module, which a shu source reaches only through web-playwright's steps. */
const PAGE_DRIVERS = [/^playwright(-core)?$/, /^@playwright\//, /^@haibun\/web-playwright(\/web-playwright(-stepper)?(\.js)?)?$/];
/** A wait for a length of time: Playwright's own, or a loop that reads again after one. */
const TIMED_WAITS = [/\bwaitForTimeout\(/g, /\bpollUntil\(/g];
const INSPECT_CALL = /\.inspect\(\)/g;
/** The steppers whose steps a waypoint of shu's views calls: core's and web-playwright's. */
const GENERIC_STEPPERS = [Haibun, VariablesStepper, ActivitiesStepper, LogicStepper, WebPlaywright];
/** The lines of an activity that are its own and not a step it calls: its heading and the waypoint it states. */
const NOT_A_CALL = /^(Activity:|waypoint )/;
/** A line written as a sentence, which is prose. */
const PROSE = /^[A-Z].*[.!?:;]$/;

const shuFiles = readdirSync(join(REPOSITORY, SHU_SOURCE), { recursive: true, encoding: "utf-8" })
	.filter((path) => /\.tsx?$/.test(path) && !path.endsWith(".d.ts"))
	.map((path) => `${SHU_SOURCE}/${path}`);
const products = sourceFiles(REPOSITORY, [SHU_SOURCE]);
const occurrences = (file: string, pattern: RegExp): number => [...readFileSync(join(REPOSITORY, file), "utf-8").matchAll(pattern)].length;
const found = (files: readonly string[], finding: string, count: (file: string) => number): TFound[] =>
	files.flatMap((file) => Array.from({ length: count(file) }, () => ({ file, finding })));

describe(
	"shu's views driven through web-playwright's steps",
	() => {
		it("holds a page driver only in web-playwright, waits for a state the page exposes, and leaves inspect() to a view's code, apart from what view-steps.baseline.json records", async () => {
			const fix = "drive the view through web-playwright's steps and the waypoints of shu's views, and wait for a state the view exposes";
			await expectWithinBaseline({
				baselineFile: BASELINE,
				testFile: TEST_FILE,
				fix,
				found: [
					...found(
						products,
						"imports a page driver",
						(file) => importsOf(parsedSource(REPOSITORY, file)).filter(({ specifier }) => PAGE_DRIVERS.some((driver) => driver.test(specifier))).length,
					),
					...found(products, "waits for a length of time", (file) => TIMED_WAITS.reduce((sum, wait) => sum + occurrences(file, wait), 0)),
					...found(
						shuFiles.filter((file) => TEST_MODULE.test(file) || !file.startsWith(VIEW_CODE)),
						"calls a view's inspect()",
						(file) => occurrences(file, INSPECT_CALL),
					),
				],
			});
		});

		it("calls only core's and web-playwright's steps in the activities of the waypoints of shu's views", async () => {
			const calls = Object.values(backgrounds)
				.flatMap((lines) => (typeof lines === "string" ? lines.split("\n") : lines))
				.filter((line): line is string => typeof line === "string" && !NOT_A_CALL.test(line) && !PROSE.test(line));
			const resolver = new Resolver(createSteppers(GENERIC_STEPPERS), []);
			const resolved = await resolver.resolveStepsFromFeatures(asExpandedFeatures([{ path: "/features/shu-views.feature", content: calls.join("\n") }]));
			expect(
				resolved.flatMap(({ featureSteps }) => featureSteps.map(({ action }) => action.stepperName)).filter((name) => !GENERIC_STEPPERS.some((stepper) => stepper.name === name)),
			).toEqual([]);
		});
	},
	REPOSITORY_SCAN_MS,
);
