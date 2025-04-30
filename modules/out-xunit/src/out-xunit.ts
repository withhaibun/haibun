import { create } from 'xmlbuilder2';
import { EOL } from 'os';

import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { findStepperFromOption, getStepperOption, stringOrError } from '@haibun/core/build/lib/util/index.js';
import { TWorld, TExecutorResult, TNotOkStepActionResult } from '@haibun/core/build/lib/defs.js';
import { AStepper, IProcessFeatureResults, IHasOptions } from '@haibun/core/build/lib/astepper.js';
import { TAnyFixme } from '@haibun/core/build/lib/fixme.js';
import { MEDIA_TYPES, TMediaType } from '@haibun/domain-storage/build/media-types.js';

const STORAGE = 'STORAGE';

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

export default class OutXUnit extends AStepper implements IProcessFeatureResults, IHasOptions {
	options = {
		OUTPUT_FILE: {
			desc: `output file (default junit.xml)`,
			parse: (port: string) => stringOrError(port),
		},
		[STORAGE]: {
			desc: 'Storage for output (default stdout)',
			parse: (input: string) => stringOrError(input),
		},
	};

	storage?: AStorage;
	name = 'Haibun-Junit';
	prettyPrint = true;
	classname = 'Haibun-Junit-Suite';
	outputFile: string;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.outputFile = getStepperOption(this, 'OUTPUT_FILE', world.moduleOptions) || 'junit.xml';
		this.storage = findStepperFromOption(steppers, this, world.moduleOptions, STORAGE);
		await Promise.resolve();
	}

	async processFeatureResult(result: TExecutorResult) {
		const junit = await this.featureResultAsJunit(result);
		if (this.storage && this.outputFile) {
			await this.storage.writeFileBuffer(this.outputFile, Buffer.from(junit), <TMediaType>MEDIA_TYPES.xml);
		} else {
			console.info(junit);
		}

	}
	async featureResultAsJunit(result: TExecutorResult) {
		const failures = result.featureResults?.filter((t) => !t.ok)?.length || 0;
		const skipped = result.featureResults?.filter((t) => t.skip)?.length || 0;
		const count = result.featureResults?.length || 0;
		const forXML: TAnyFixme = {
			testsuites: {
				'@tests': count,
				'@name': this.name,
				'@failures': failures,
				testsuite: {
					'@name': this.classname,
					'@tests': count,
					'@skipped': skipped,
					'@failures': failures,
					testcase: [],
				},
			},
		};
		for (const t of result.featureResults || []) {
			const testCase: TTestCase = {
				'@name': t.path,
				'@id': t.path,
			};

			if (!t.ok) {
				testCase.failure = this.getFailResult(t.stepResults.find((r) => !r.ok)?.actionResult as TNotOkStepActionResult);
			}

			forXML.testsuites.testsuite.testcase.push(testCase);
		}
		const junit = create(forXML).end({ prettyPrint: this.prettyPrint, newline: EOL });
		return Promise.resolve(junit);
	}

	getFailResult(failure: TNotOkStepActionResult) {
		const failResult: TFailResult = {
			'@message': `${failure.name}: ${failure.message}`,
			'@type': 'fail',
		};

		return failResult;
	}
	steps = {};
}
