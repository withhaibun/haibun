"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Executor = void 0;
const util_1 = require("./util");
class Executor {
    constructor(steppers, world) {
        this.steppers = steppers;
        this.world = world;
    }
    async execute(features) {
        let ok = true;
        let featureResults = [];
        for (const feature of features) {
            this.world.logger.log(`feature: ${feature.path}`);
            const featureResult = await this.doFeature(feature);
            ok = ok && featureResult.ok;
            featureResults.push(featureResult);
        }
        return { ok, results: featureResults };
    }
    async doFeature(feature) {
        let ok = true;
        let stepResults = [];
        for (const step of feature.vsteps) {
            this.world.logger.log(`   ${step.in}\r`);
            const result = await Executor.doFeatureStep(step, this.world.logger);
            if (this.world.options.step_delay) {
                await util_1.sleep(this.world.options.step_delay);
            }
            ok = ok && result.ok;
            this.world.logger.log(ok);
            stepResults.push(result);
            if (!ok) {
                break;
            }
        }
        const featureResult = { path: feature.path, ok, stepResults };
        return featureResult;
    }
    static async doFeatureStep(vstep, logger) {
        let ok = true;
        let actionResults = [];
        for (const a of vstep.actions) {
            let res;
            try {
                res = await a.step.action(a.named, vstep);
            }
            catch (caught) {
                logger.error(caught.stack);
                res = util_1.actionNotOK(caught.message, { caught: caught.stack.toString() });
            }
            actionResults.push({ ...res, name: a.name });
            ok = ok && res.ok;
            if (!res.ok) {
                break;
            }
        }
        return { ok, in: vstep.in, actionResults, seq: vstep.seq };
    }
    async close() {
        for (const s of this.steppers) {
            if (s.close) {
                console.info('closing', s.constructor.name);
                await s.close();
            }
        }
    }
}
exports.Executor = Executor;
//# sourceMappingURL=Executor.js.map