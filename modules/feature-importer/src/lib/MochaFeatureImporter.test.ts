
import { TFeatureParsed } from './defs';
import { getFeatures } from './MochaFeatureImporter';

describe('mocha code2haibun', () => {
    it('one-liner', () => {
        expect(getFeatures(`await page.goto('foo');\n`)).toEqual({ backgrounds: { Page1: { Page1: 'foo' } }, feature: 'go to `Page1`', ok: true });
    });
    it('multi-liner', () => {
        const code = `
    

await page.goto('https://entertainment.slashdot.org/')

await page.setViewportSize({ width: 808, height: 1430 })

await page.waitForSelector('#firehoselist > #firehose-166670035 > #fhbody-166670035 > #text-166670035 > i')
await page.click('#firehoselist > #firehose-166670035 > #fhbody-166670035 > #text-166670035 > i')

await page.waitForSelector('.nav-secondary-wrap > .nav-secondary > ul > li:nth-child(3) > a')
await page.click('.nav-secondary-wrap > .nav-secondary > ul > li:nth-child(3) > a')

await navigationPromise({"action":"NAVIGATION","frameId":null,"frameUrl":null})

`;
        const expected: TFeatureParsed = {
            "backgrounds": {
                "Page1": {
                    "Page1": "https://entertainment.slashdot.org/",
                    "Width1": 808,
                    "Height1": 1430,
                    "Selector1": "#firehoselist > #firehose-166670035 > #fhbody-166670035 > #text-166670035 > i",
                    "Selector2": "#firehoselist > #firehose-166670035 > #fhbody-166670035 > #text-166670035 > i",
                    "Selector3": ".nav-secondary-wrap > .nav-secondary > ul > li:nth-child(3) > a",
                    "Selector4": ".nav-secondary-wrap > .nav-secondary > ul > li:nth-child(3) > a",
                },
            },
            "feature": "go to `Page1`\nSet viewport to `Width1`, `Height1`\nwait for `Selector1`\nclick `Selector2`\nwait for `Selector3`\nclick `Selector4`",
            ok: true
        }
        const res = getFeatures(code)
        expect(res).toEqual(expected);
    });
});

