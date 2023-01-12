import HtmlGenerator, { TStepSummary } from "./html-generator.js";

describe('getASummary', () => {
    const subResults: TStepSummary[] = [
        {
            seq: 1,
            in: 'test in 1',
            name: 'testIn1',
            traces: [],
            start: 123,
            ok: true,
            sourcePath: '/a/1',
            subResults: []
        },
        {
            seq: 1,
            in: 'test in 2',
            name: 'testIn2',
            traces: [],
            start: 456,
            ok: true,
            sourcePath: '/a/1',
            subResults: []
        },
        {
            seq: 1,
            in: 'test in 3',
            name: 'testIn3',
            traces: [],
            start: 789,
            ok: true,
            sourcePath: '/a/2',
            subResults: []
        }
    ]
    it('gets a result', () => {
        const result = new HtmlGenerator().getSteps(subResults, '')
        expect(result).toBeDefined();
    })
});
