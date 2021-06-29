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
const util = __importStar(require("./util"));
const run_1 = require("./run");
const TestSteps_1 = require("./TestSteps");
const util_1 = require("./util");
describe('output', () => {
    it('TResult', async () => {
        const base = process.cwd() + '/test/projects/specl/output-asXunit';
        const specl = util_1.getOptionsOrDefault(base);
        const { world } = util_1.getDefaultWorld();
        const { result } = await run_1.run({ specl, base, addSteppers: [TestSteps_1.TestSteps], world });
        expect(result.ok).toBe(false);
        const output = await util.resultOutput(undefined, result, world.shared);
        expect(typeof output).toBe('object');
        expect(result.results?.length).toBe(2);
    });
    it('AsXUnit', async () => {
        const base = process.cwd() + '/test/projects/specl/output-asXunit';
        const specl = util_1.getOptionsOrDefault(base);
        const { world } = util_1.getDefaultWorld();
        const { result } = await run_1.run({ specl, base, addSteppers: [TestSteps_1.TestSteps], world });
        expect(result.ok).toBe(false);
        const output = await util.resultOutput('AsXUnit', result, world.shared);
        expect(typeof output).toBe('string');
        expect(output.startsWith('<?xml')).toBeTruthy();
    });
});
const step = {
    match: /^(?<one>.*?) is (?<two>.*?)$/,
    action: async () => util.actionNotOK('test'),
};
describe('getMatches', () => {
    it('gets named matches', () => {
        expect(util.getNamedMatches(step.match, 'It is set')).toEqual({ one: 'It', two: 'set' });
    });
});
describe('isLowerCase', () => {
    expect(util.isLowerCase('a')).toBe(true);
    expect(util.isLowerCase('A')).toBe(false);
    expect(util.isLowerCase('0')).toBe(false);
});
describe('processEnv', () => {
    it('process env', () => {
        const specl = util.getDefaultOptions();
        const { protoOptions } = util.processEnv({ HAIBUN_TEST: 'true' }, specl.options);
        expect(protoOptions.extraOptions['HAIBUN_TEST']).toBeDefined();
    });
});
describe('getStepperOptions', () => {
    it('finds stepper options', async () => {
        const steppers = await util.getSteppers({ steppers: [], addSteppers: [TestSteps_1.TestStepsWithOptions], ...util_1.getDefaultWorld() });
        const conc = util.getStepperOptions(TestSteps_1.HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, 'true', steppers);
        expect(conc).toBeDefined();
    });
    it('fills extra', async () => {
        const { world } = util_1.getDefaultWorld();
        const specl = { ...util.getDefaultOptions(), extraOptions: { [TestSteps_1.HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: 'true' } };
        const steppers = await util.getSteppers({ steppers: [], addSteppers: [TestSteps_1.TestStepsWithOptions], ...util_1.getDefaultWorld() });
        util.applyExtraOptions(specl, steppers, world);
        expect(world.options[TestSteps_1.HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]).toBe(42);
    });
    it('throws for unfilled extra', async () => {
        const { world } = util_1.getDefaultWorld();
        const specl = { ...util.getDefaultOptions(), extraOptions: { HAIBUN_NE: 'true' } };
        expect(() => util.applyExtraOptions(specl, [], world)).toThrow();
    });
});
//# sourceMappingURL=util.test.js.map