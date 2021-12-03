import { create } from 'xmlbuilder2';
import { EOL } from 'os';

import { TResult, TNotOkStepActionResult, TResultOutput } from '@haibun/core/build/lib/defs';
import { TEST_RESULT } from '@haibun/core/build/lib/interfaces/logger';

type TTestCase = {
  '@name': string;
  '@id': string;
  skipped?: {};
  ok?: boolean;
  'system-out'?: string;
  failure?: TFailResult;
};

type TFailResult = {
  '@message': string;
  '@type': string;
  type?: string;
};

export default class OutXUnit implements TResultOutput {
  async getOutput(result: TResult, { name = 'Haibun-Junit', prettyPrint = true, classname = 'Haibun-Junit-Suite' }) {
    const failures = result.results?.filter((t) => !t.ok)?.length;
    const skipped = result.results?.filter((t) => t.skip)?.length;
    const count = result.results?.length;
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

    if (!result.results) {
      return;
    }

    for (const t of result.results) {
      const testCase: TTestCase = {
        '@name': t.path,
        '@id': t.path,
      };

      if (!t.ok) {
        testCase.failure = this.getFailResult(t.stepResults.find(r => !r.ok)?.actionResults.find(a => !a.ok) as TNotOkStepActionResult);
      }

      if (t.comments) {
        testCase['system-out'] = t.comments;
      }

      forXML.testsuites.testsuite.testcase.push(testCase);
    }
    return create(forXML).end({ prettyPrint, newline: EOL });
  }
  async writeOutput(result: TResult, args: any) {
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
