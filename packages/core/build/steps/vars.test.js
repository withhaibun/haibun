"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Executor_1 = require("../lib/Executor");
const Resolver_1 = require("../lib/Resolver");
const util_1 = require("../lib/util");
const vars_1 = require("./vars");
describe('vars', () => {
    it('assigns', async () => {
        const { world } = util_1.getDefaultWorld();
        const steppers = await util_1.getSteppers({ steppers: ['vars'], world });
        const resolver = new Resolver_1.Resolver(steppers, 'all', world);
        const test = 'Given I set x to y';
        const actions = resolver.findSteps(test);
        const tvstep = {
            in: test,
            seq: 0,
            actions,
        };
        await Executor_1.Executor.doFeatureStep(tvstep, world.logger);
        expect(world.shared.x).toBe('y');
    });
    it('assigns empty', async () => {
        const { world } = util_1.getDefaultWorld();
        const steppers = await util_1.getSteppers({ steppers: ['vars'], world });
        const resolver = new Resolver_1.Resolver(steppers, '', world);
        const test = 'Given I set x to y';
        const actions = resolver.findSteps(test);
        const tvstep = {
            in: test,
            seq: 0,
            actions,
        };
        await Executor_1.Executor.doFeatureStep(tvstep, world.logger);
        expect(world.shared.x).toBe('y');
    });
    it('empty does not overwrite', async () => {
        const { world } = util_1.getDefaultWorld();
        const shared = { x: 'notY' };
        const steppers = await util_1.getSteppers({ steppers: ['vars'], world: { ...world, shared } });
        const resolver = new Resolver_1.Resolver(steppers, 'all', world);
        const test = 'Given I set empty x to y';
        const actions = resolver.findSteps(test);
        const tvstep = {
            in: test,
            seq: 0,
            actions,
        };
        const res = await Executor_1.Executor.doFeatureStep(tvstep, world.logger);
        expect(shared.x).toBe('notY');
        expect(res.actionResults[0].details).toEqual(vars_1.didNotOverwrite('x', 'notY', 'y'));
    });
});
//# sourceMappingURL=vars.test.js.map