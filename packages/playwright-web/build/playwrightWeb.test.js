"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const Resolver_1 = require("@haibun/core/build/lib/Resolver");
const Executor_1 = require("@haibun/core/build/lib/Executor");
const Logger_1 = __importStar(require("@haibun/core/build/lib/Logger"));
const util_1 = require("@haibun/core/build/lib/util");
describe('playwrightWeb', () => {
    it('sets up steps', async () => {
        const steppers = await util_1.getSteppers({ steppers: ['@haibun/playwright-web'], ...util_1.getDefaultWorld() });
        expect(Object.keys(steppers[0].steps).length > 0).toBe(true);
        expect(Object.values(steppers[0].steps).every((s) => !!s.action)).toBe(true);
    });
    it('sets browser type and device', async () => {
        const { world } = util_1.getDefaultWorld();
        const steppers = await util_1.getSteppers({ steppers: ['@haibun/playwright-web'], world });
        const resolver = new Resolver_1.Resolver(steppers, '', world);
        const test = 'using firefox.Pixel 5 browser';
        const actions = resolver.findSteps(test);
        const tvstep = {
            in: test,
            seq: 0,
            actions,
        };
        await Executor_1.Executor.doFeatureStep(tvstep, world.logger);
        expect(steppers[0].bf.browserType.name()).toBe('firefox');
        expect(steppers[0].bf.device).toBe('Pixel 5');
    });
    it('fails setting browser type and device', async () => {
        const { world } = util_1.getDefaultWorld();
        const logger = new Logger_1.default(Logger_1.LOGGER_NONE);
        const steppers = await util_1.getSteppers({ steppers: ['@haibun/playwright-web'], world });
        const resolver = new Resolver_1.Resolver(steppers, '', world);
        const test = 'using nonexistant browser';
        const actions = resolver.findSteps(test);
        const tvstep = {
            in: test,
            seq: 0,
            actions,
        };
        const result = await Executor_1.Executor.doFeatureStep(tvstep, logger);
        expect(result.actionResults[0].ok).toBe(false);
    });
});
//# sourceMappingURL=playwrightWeb.test.js.map