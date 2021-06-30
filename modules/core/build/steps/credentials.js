"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const defs_1 = require("../lib/defs");
const Credentials = class Credentials {
    constructor(world) {
        this.steps = {
            hasRandomUsername: {
                match: /^When I have a valid random username <(?<name>.+)>/,
                action: async ({ name }) => {
                    this.generateRandomUsername(name);
                    return defs_1.OK;
                },
            },
            hasRandomPassword: {
                match: /^When I have a valid random password <(?<name>.+)>/,
                action: async ({ name }) => {
                    this.generateRandomPassword(name);
                    return defs_1.OK;
                },
            },
        };
        this.world = world;
    }
    generateRandomUsername(ref) {
        this.world.shared[ref] = ['rnd', Math.floor(Date.now() / 1000).toString(36), Math.floor(Math.random() * 1e8).toString(36)].join('_');
        return this.world.shared[ref];
    }
    generateRandomPassword(ref) {
        this.world.shared[ref] = [
            'testpass',
            Math.floor(Math.random() * 1e8)
                .toString(36)
                .toUpperCase(),
        ].join('_');
        return this.world.shared[ref];
    }
    getRandom(name) {
        const val = this.world.shared[name];
        return val;
    }
};
exports.default = Credentials;
//# sourceMappingURL=credentials.js.map