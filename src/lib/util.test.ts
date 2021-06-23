import { TStep } from './defs';
import * as util from './util';
import Logger, { LOGGER_NONE } from './Logger';
import { run } from './run';
import { TestSteps } from './TestSteps';
import { getConfigOrDefault } from './util';

describe('output', () => {
  it('TResult', async () => {
    const base = process.cwd() + '/test/projects/specl/output-asXunit';
    const specl = getConfigOrDefault(base);

    const { result, shared } = await run({ specl, base, addSteppers: [TestSteps], logger: new Logger(LOGGER_NONE) });
    expect(result.ok).toBe(false);
    const output = await util.resultOutput(undefined, result, shared);
    expect(typeof output).toBe('object');
    expect(result.results?.length).toBe(2);
  });
  it('AsXUnit', async () => {
    const base = process.cwd() + '/test/projects/specl/output-asXunit';
    const specl = getConfigOrDefault(base);

    const { result, shared } = await run({ specl, base, addSteppers: [TestSteps], logger: new Logger(LOGGER_NONE) });
    expect(result.ok).toBe(false);
    const output = await util.resultOutput('AsXUnit', result, shared);
    expect(typeof output).toBe('string');
    expect(output.startsWith('<?xml')).toBeTruthy();
  });
});


const step: TStep = {
    match: /^(?<one>.*?) is (?<two>.*?)$/,
    action: async () => util.actionNotOK('test')
};

describe('getMatches', () => {
    it('gets named matches', () => {
        expect(util.getNamedMatches(step.match!, 'It is set')).toEqual({ one: 'It', two: 'set' });
    });
});

describe('isLowerCase', () => {
    expect(util.isLowerCase('a')).toBe(true);
    expect(util.isLowerCase('A')).toBe(false);
    expect(util.isLowerCase('0')).toBe(false);
})