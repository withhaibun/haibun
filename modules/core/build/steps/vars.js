"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.didNotOverwrite = void 0;
const defs_1 = require("../lib/defs");
const vars = class Vars {
    constructor(world) {
        this.steps = {
            set: {
                gwta: 'set (empty )?(?<what>.+) to (?<value>.+)',
                section: 'Background',
                action: async ({ what, value }, vstep) => {
                    // FIXME hokey
                    const emptyOnly = !vstep.in.match(/ set missing /);
                    if (!emptyOnly || this.world.shared[what] === undefined) {
                        this.world.shared[what] = value;
                        return defs_1.OK;
                    }
                    return { ...defs_1.OK, details: didNotOverwrite(what, this.world.shared[what], value) };
                },
            },
            background: {
                match: /^Background: ?(?<background>.+)?$/,
                action: async ({ background }) => {
                    this.world.shared.background = background;
                    return defs_1.OK;
                },
            },
            feature: {
                match: /^Feature: ?(?<feature>.+)?$/,
                action: async ({ feature }) => {
                    this.world.shared.feature = feature;
                    return defs_1.OK;
                },
            },
            scenario: {
                match: /^Scenario: (?<scenario>.+)$/,
                action: async ({ scenario }) => {
                    this.world.shared.scenario = scenario;
                    return defs_1.OK;
                },
            },
            display: {
                gwta: 'display (?<what>.+)',
                action: async ({ what }) => {
                    this.world.logger.log(`${what} is ${this.world.shared[what]}`);
                    return defs_1.OK;
                },
            },
        };
        this.world = world;
    }
};
exports.default = vars;
function didNotOverwrite(what, present, value) {
    `did not overwrite ${what} value of "${present}" with "${value}"`;
}
exports.didNotOverwrite = didNotOverwrite;
//# sourceMappingURL=vars.js.map