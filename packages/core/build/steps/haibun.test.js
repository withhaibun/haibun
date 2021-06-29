"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Executor_1 = require("../lib/Executor");
const Resolver_1 = require("../lib/Resolver");
const util_1 = require("../lib/util");
describe('haibun', () => {
    it('finds prose', async () => {
        const { world } = util_1.getDefaultWorld();
        const steppers = await util_1.getSteppers({ steppers: ['haibun'], world });
        const resolver = new Resolver_1.Resolver(steppers, '', world);
        const test = 'A sentence.';
        const actions = resolver.findSteps(test);
        const tvstep = {
            in: test,
            seq: 0,
            actions,
        };
        const res = await Executor_1.Executor.doFeatureStep(tvstep, world.logger);
        expect(res.ok).toBe(true);
        expect(res.actionResults[0].name).toBe('prose');
    });
});
//# sourceMappingURL=haibun.test.js.map