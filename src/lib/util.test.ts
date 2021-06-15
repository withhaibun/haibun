import { notOk, TStep } from './defs';
import * as util from './util';

const step: TStep = {
    match: /^(?<one>.*?) is (?<two>.*?)$/,
    action: async () => notOk
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