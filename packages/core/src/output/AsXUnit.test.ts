const { convert } = require('xmlbuilder2');

import AsXUnit from './AsXUnit';
import { run } from '../lib/run';
import { TestSteps } from '../lib/TestSteps';
import { getOptionsOrDefault, getDefaultWorld } from '../lib/util';

describe('AsXML', () => {
  it('transforms single pass result to xunit', async () => {
    const base = process.cwd() + '/test/projects/specl/self-contained';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld() });

    expect(result.ok).toBe(true);
    const asXunit = new AsXUnit();
    const res = await asXunit.getOutput(result, {});

    const obj = convert(res, { format: 'object' });
    expect(obj.testsuites.testsuite.testcase['@name']).toBeDefined();
    expect(obj.testsuites['@tests']).toBe('1');
    expect(obj.testsuites.testsuite.testcase.failure).toBeUndefined();
  });
  it('transforms multi type result to xunit', async () => {
    const base = process.cwd() + '/test/projects/specl/multiple';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld() });
    expect(result.ok).toBe(false);
    const asXunit = new AsXUnit();
    const res = await asXunit.getOutput(result, {});
    const obj = convert(res, { format: 'object' });

    expect(obj.testsuites.testsuite.testcase.length).toBe(2);
    expect(obj.testsuites['@tests']).toBe('2');
    expect(obj.testsuites['@failures']).toBe('1');
    expect(obj.testsuites.testsuite.testcase[0].failure).toBeDefined();
    expect(obj.testsuites.testsuite.testcase[1].failure).toBeUndefined();
  });
});
