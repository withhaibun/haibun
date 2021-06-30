"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Resolver = void 0;
const defs_1 = require("./defs");
const util_1 = require("./util");
class Resolver {
    constructor(steppers, mode, world) {
        this.steppers = steppers;
        this.mode = mode;
        this.world = world;
    }
    async resolveSteps(features) {
        const expanded = [];
        for (const feature of features) {
            const steps = await this.addSteps(feature);
            expanded.push(steps);
        }
        return expanded;
    }
    async addSteps(feature) {
        const vsteps = feature.feature.split('\n').map((featureLine, seq) => {
            const actionable = util_1.getActionable(featureLine);
            const actions = this.findSteps(actionable);
            if (actions.length > 1) {
                throw Error(`more than one step found for ${featureLine} ` + JSON.stringify(actions));
            }
            else if (actions.length < 1 && this.mode !== 'some') {
                throw Error(`no step found for ${featureLine} from ` + util_1.describeSteppers(this.steppers));
            }
            return { in: featureLine, seq, actions };
        });
        return { ...feature, vsteps };
    }
    findSteps(actionable) {
        if (!actionable.length) {
            return [comment];
        }
        let found = [];
        const doMatch = (r, name, step) => {
            if (r.test(actionable)) {
                const named = util_1.getNamedMatches(r, actionable);
                found.push({ name, step, named });
            }
        };
        for (const { steps } of this.steppers) {
            for (const name in steps) {
                const step = steps[name];
                if (step.gwta) {
                    const f = step.gwta.charAt(0);
                    const s = util_1.isLowerCase(f) ? ['[', f, f.toUpperCase(), ']', step.gwta.substring(1)].join('') : step.gwta;
                    const r = new RegExp(`^(Given|When|Then|And)?( the )?( I('m)? (am )?)? ?${s}`);
                    doMatch(r, name, step);
                }
                else if (step.match) {
                    doMatch(step.match, name, step);
                }
                else if (actionable.length > 0 && step.exact === actionable) {
                    found.push({ name, step });
                }
            }
        }
        return found;
    }
}
exports.Resolver = Resolver;
const comment = {
    name: 'comment',
    step: {
        match: /.*/,
        action: async () => {
            return defs_1.OK;
        },
    },
};
//# sourceMappingURL=Resolver.js.map