const { convert } = require('xmlbuilder2');

import AsXUnit from './AsXUnit';
import { run } from '@haibun/core/build/lib/run';
import { TestSteps } from '@haibun/core/build/lib/TestSteps';
import { getOptionsOrDefault, getDefaultWorld, resultOutput } from '@haibun/core/build/lib/util';

describe('AsXML transforms', () => {
  it('transforms single pass result to xunit', async () => {
    const base = process.cwd() + '/test/self-contained';
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
    const base = process.cwd() + '/test/multiple';
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

  it('run AsXUnit', async () => {
    const base = process.cwd() + '/test/output-asXunit';
    const specl = getOptionsOrDefault(base);
    const { world } = getDefaultWorld();

    const { result } = await run({ specl, base, addSteppers: [TestSteps], world });
    expect(result.ok).toBe(false);
    const output = await resultOutput('@haibun/out-xunit/', result, world.shared);
    expect(typeof output).toBe('string');
    expect(output.startsWith('<?xml')).toBeTruthy();
  });