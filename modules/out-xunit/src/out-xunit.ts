import { create } from 'xmlbuilder2';
import { EOL } from 'os';

import { AStepper, TWorld, TExecutorResult, TNotOkStepActionResult, IResultOutput } from '@haibun/core/build/lib/defs.js';

type TTestCase = {
	'@name': string;
	'@id': string;
	skipped?: object;
	ok?: boolean;
	'system-out'?: string;
	failure?: TFailResult;
};

type TFailResult = {
	'@message': string;
	'@type': string;
	type?: string;
};

export default class OutXUnit implements IResultOutput {
	async setWorld(world: TWorld, steppers: AStepper[]) {
		return;
	}
	async getOutput(result: TExecutorResult, { name = 'Haibun-Junit', prettyPrint = true, classname = 'Haibun-Junit-Suite' }) {
		const failures = result.featureResults?.filter((t) => !t.ok)?.length || 0;
		const skipped = result.featureResults?.filter((t) => t.skip)?.length || 0;
		const count = result.featureResults?.length || 0;
		const forXML: any = {
			testsuites: {
				'@tests': count,
				'@name': name,
				'@failures': failures,
				testsuite: {
					'@name': classname,
					'@tests': count,
					'@skipped': skipped,
					'@failures': failures,
					testcase: [],
				},
			},
		};

		for (const t of result.featureResults) {
			const testCase: TTestCase = {
				'@name': t.path,
				'@id': t.path,
			};

			if (!t.ok) {
				testCase.failure = this.getFailResult(t.stepResults.find((r) => !r.ok)?.actionResult as TNotOkStepActionResult);
			}

			// if (t.comments) {
			//   testCase['system-out'] = t.comments;
			// }

			forXML.testsuites.testsuite.testcase.push(testCase);
		}
		return create(forXML).end({ prettyPrint, newline: EOL });
	}

	async writeOutput(result: TExecutorResult, args: any) {
		return this.getOutput(result, args);
	}

	getFailResult(failure: TNotOkStepActionResult) {
		const failResult: TFailResult = {
			'@message': `${failure.name}: ${failure.message}`,
			'@type': 'fail',
		};

		return failResult;
	}
}
