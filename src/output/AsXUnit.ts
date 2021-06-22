import { create } from 'xmlbuilder2';
import { EOL } from 'os';

import { TResult, TNotOkStepActionResult } from '../lib/defs';

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

export default class AsXUnit {
  result: TResult;
  constructor(results: TResult) {
    this.result = results;
  }
  getResults({ name = 'Haibun-Junit', prettyPrint = true, classname = 'Haibun-Junit-Suite' }) {
    const failures = this.result.results?.filter((t) => !t.ok)?.length;
    const skipped = this.result.results?.filter((t) => t.skip)?.length;
    const count = this.result.results?.length;
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

    if (!this.result.results) {
      return;
    }

    for (const t of this.result.results) {
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
  getFailResult(failure: TNotOkStepActionResult) {
    const failResult: TFailResult = {
      '@message': `${failure.name}: ${failure.message}`,
      '@type': 'fail',
    };

    return failResult;
  }
}
