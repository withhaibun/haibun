"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestStepsWithOptions = exports.HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS = exports.TestSteps = void 0;
const util_1 = require("./util");
const TestSteps = class TestSteps {
    constructor() {
        this.steps = {
            test: {
                exact: 'When I have a test',
                action: async (input) => util_1.actionOK(),
            },
            passes: {
                exact: 'Then the test should pass',
                action: async (input) => util_1.actionOK(),
            },
            fails: {
                exact: 'Then the test can fail',
                action: async (input) => util_1.actionNotOK('test'),
            },
            named: {
                match: /^Then the parameter (?<param>.+) is accepted$/,
                action: async ({ param }) => {
                    return param === 'x' ? util_1.actionOK() : util_1.actionNotOK('test');
                },
            },
            throws: {
                gwta: 'throw an exception',
                action: async () => {
                    throw Error(`<Thrown for test case>`);
                },
            },
        };
    }
};
exports.TestSteps = TestSteps;
exports.HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS = 'HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS';
const TestStepsWithOptions = class TestStepsWithOptions {
    constructor(world) {
        this.options = {
            EXISTS: {
                desc: 'option exists',
                parse: (input) => 42
            },
        };
        this.steps = {
            test: {
                exact: 'When I have a stepper option',
                action: async () => {
                    const res = util_1.getStepperOption(this, 'EXISTS', this.world.options);
                    return util_1.actionOK(`${res}`);
                },
            },
        };
        this.world = world;
    }
};
exports.TestStepsWithOptions = TestStepsWithOptions;
//# sourceMappingURL=TestSteps.js.map