"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const defs_1 = require("./defs");
const util_1 = require("./util");
const Resolver_1 = require("./Resolver");
class TestStepper {
    constructor() {
        this.steps = {
            exact: {
                exact: 'exact1',
                action: async () => defs_1.OK,
            },
            match: {
                match: /match(?<num>1)/,
                action: async () => defs_1.OK,
            },
            gwta: {
                gwta: 'gwta(?<num>.)',
                action: async () => defs_1.OK,
            },
        };
    }
}
describe('validate map steps', () => {
    const steppers = [new TestStepper()];
    const val = new Resolver_1.Resolver(steppers, '', util_1.getDefaultWorld().world);
    test('exact', async () => {
        const features = [{ path: 'l1', feature: `exact1` }];
        const res = await val.resolveSteps(features);
        const { vsteps } = res[0];
        expect(vsteps[0].actions[0].named).toBeUndefined();
    });
    test('match', async () => {
        const features = [{ path: 'l1', feature: `match1` }];
        const res = await val.resolveSteps(features);
        const { vsteps } = res[0];
        expect(vsteps[0].actions[0].named).toEqual({ num: '1' });
    });
    test('gwta', async () => {
        const features = [{ path: 'l1', feature: `gwta2\nGiven I'm gwta3\nWhen I am gwta4\nGwta5\nThen the gwta6` }];
        const res = await val.resolveSteps(features);
        const { vsteps } = res[0];
        expect(vsteps[0].actions[0].named).toEqual({ num: '2' });
        expect(vsteps[1].actions[0].named).toEqual({ num: '3' });
        expect(vsteps[2].actions[0].named).toEqual({ num: '4' });
        expect(vsteps[3].actions[0].named).toEqual({ num: '5' });
        expect(vsteps[4].actions[0].named).toEqual({ num: '6' });
    });
});
//# sourceMappingURL=Resolver.test.js.map