"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const defs_1 = require("../lib/defs");
const Haibun = class Haibun {
    constructor(world) {
        this.steps = {
            prose: {
                gwta: '.*[.?!]$',
                action: async () => defs_1.OK,
            },
            startStepDelay: {
                gwta: 'start step delay of (?<ms>.+)',
                action: async ({ ms }) => {
                    this.world.options.step_delay = parseInt(ms, 10);
                    return defs_1.OK;
                },
            },
            stoptStepDelay: {
                gwta: 'stop step delay',
                action: async () => {
                    return defs_1.OK;
                },
            },
        };
        this.world = world;
    }
};
exports.default = Haibun;
//# sourceMappingURL=haibun.js.map