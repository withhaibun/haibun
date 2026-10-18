import { create } from "xmlbuilder2";
import { EOL } from "os";

import { AStorage } from "@haibun/domain-storage/domains/storage.js";
import { findStepperFromOptionOrKind, getStepperOption, stringOrError } from "@haibun/core/lib/util/index.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import type { TExecutorResult } from "@haibun/core/schema/protocol.js";
import { LEVEL_STATUS, type TFeatureState } from "@haibun/core/lib/actuality/machines/actuality.js";
import { AStepper, IHasCycles, IHasOptions, StepperKinds, IStepperCycles } from "@haibun/core/lib/astepper.js";

type TFailResult = { "@message": string; "@type": string };

type TTestCase = { "@name": string; "@id": string; failure?: TFailResult };

type TJunit = {
	testsuites: { "@tests": number; "@name": string; "@failures": number; testsuite: { "@name": string; "@tests": number; "@failures": number; testcase: TTestCase[] } };
};

/** A feature's test case: failed where the feature failed, with the step the machine holds as its first failure. */
function testCaseOf(feature: TFeatureState): TTestCase {
	const testCase: TTestCase = { "@name": feature.path ?? feature.id, "@id": feature.id };
	if (feature.status !== LEVEL_STATUS.failed) return testCase;
	const first = feature.firstFailure;
	// A feature fails without a failure of its own where only a handed-out call or a speculative step failed in it.
	const message =
		first === undefined ? `${feature.id} failed without a failed step of its own` : [first.id, first.step, first.message].filter((part) => part !== undefined).join(": ");
	return { ...testCase, failure: { "@message": message, "@type": "fail" } };
}

/** The file the report is written to, where the OUTPUT_FILE option doesn't name one. */
const JUNIT_OUTPUT_FILE = "junit.xml";

export default class OutJUnit extends AStepper implements IHasOptions, IHasCycles {
	description = "Generate JUnit XML reports from test results";

	cycles: IStepperCycles = {
		endExecution: async (results: TExecutorResult) => {
			const junit = await this.featureResultAsJunit(results);
			if (this.storage && this.outputFile) {
				await this.storage.writeFileBuffer(this.outputFile, Buffer.from(junit));
			} else {
				console.info(junit);
			}
		},
	};
	options = {
		OUTPUT_FILE: { desc: `output file (default junit.xml)`, parse: (port: string) => stringOrError(port) },
		[StepperKinds.STORAGE]: { desc: "Storage for output (default stdout)", parse: (input: string) => stringOrError(input) },
	};

	storage?: AStorage;
	name = "Haibun-Junit";
	prettyPrint = true;
	classname = "Haibun-Junit-Suite";
	outputFile = JUNIT_OUTPUT_FILE;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.outputFile = getStepperOption(this, "OUTPUT_FILE", world.moduleOptions) || JUNIT_OUTPUT_FILE;
		this.storage = findStepperFromOptionOrKind(steppers, this, world.moduleOptions, StepperKinds.STORAGE);
		await Promise.resolve();
	}

	/** The report of an execution's features, as the actuality machine held them once the execution ended: a test case for
	 *  each feature that ran, failed where the feature failed, with its first failed step. */
	featureResultAsJunit(result: TExecutorResult) {
		const { features } = result.actuality;
		const failures = features.filter((feature) => feature.status === LEVEL_STATUS.failed).length;
		const forXML: TJunit = {
			testsuites: {
				"@tests": features.length,
				"@name": this.name,
				"@failures": failures,
				testsuite: { "@name": this.classname, "@tests": features.length, "@failures": failures, testcase: features.map((feature) => testCaseOf(feature)) },
			},
		};
		return Promise.resolve(create(forXML).end({ prettyPrint: this.prettyPrint, newline: EOL }));
	}

	steps = {};
}
