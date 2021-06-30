"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = void 0;
const fs_1 = require("fs");
const features_1 = require("./features");
const Executor_1 = require("./Executor");
const Resolver_1 = require("./Resolver");
const util_1 = require("./util");
async function run({ specl, base, world, addSteppers = [], featureFilter = '', protoOptions: protoOptions = { options: {}, extraOptions: {} }, }) {
    const features = await util_1.recurse(`${base}/features`, [/\.feature$/, featureFilter]);
    const backgrounds = fs_1.existsSync(`${base}/backgrounds`) ? await util_1.recurse(`${base}/backgrounds`, [/\.feature$/]) : [];
    const steppers = await util_1.getSteppers({ steppers: specl.steppers, addSteppers, world });
    try {
        util_1.applyExtraOptions(protoOptions, steppers, world);
    }
    catch (error) {
        console.log(error);
        return { result: { ok: false, failure: { stage: 'Options', error: { details: error.message, context: error } } } };
    }
    let expandedFeatures;
    try {
        expandedFeatures = await expand(backgrounds, features);
    }
    catch (error) {
        return { result: { ok: false, failure: { stage: 'Expand', error: error.message } } };
    }
    let mappedValidatedSteps;
    try {
        const resolver = new Resolver_1.Resolver(steppers, specl.mode, world);
        mappedValidatedSteps = await resolver.resolveSteps(expandedFeatures);
    }
    catch (error) {
        return { result: { ok: false, failure: { stage: 'Resolve', error: { details: error.message, context: { steppers, mappedValidatedSteps } } } } };
    }
    const executor = new Executor_1.Executor(steppers, world);
    const result = await executor.execute(mappedValidatedSteps);
    if (!result.ok) {
        result.failure = { stage: 'Execute', error: { context: result.results?.filter((r) => !r.ok).map((r) => r.path) } };
    }
    return { result };
}
exports.run = run;
async function expand(backgrounds, features) {
    const expandedBackgrounds = await features_1.expandBackgrounds(backgrounds);
    const expandedFeatures = await features_1.expandFeatures(features, expandedBackgrounds);
    return expandedFeatures;
}
//# sourceMappingURL=run.js.map