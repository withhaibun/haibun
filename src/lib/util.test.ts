import { notOk, TStep } from './defs';
import * as util from './util';

const step: TStep = {
    match: /^(?<one>.*?) is (?<two>.*?)$/g,
    action: async () => notOk
};

describe('getMatches', () => {
    it('gets named matches', () => {
        expect(util.getNamedMatches('It is set', step)).toEqual({ one: 'It', two: 'set' });
    });
});