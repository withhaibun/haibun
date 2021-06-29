"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const { convert } = require('xmlbuilder2');
const AsXUnit_1 = __importDefault(require("./AsXUnit"));
const run_1 = require("../lib/run");
const TestSteps_1 = require("../lib/TestSteps");
const util_1 = require("../lib/util");
describe('AsXML', () => {
    it('transforms single pass result to xunit', async () => {
        const base = process.cwd() + '/test/projects/specl/self-contained';
        const specl = util_1.getOptionsOrDefault(base);
        const { result } = await run_1.run({ specl, base, addSteppers: [TestSteps_1.TestSteps], ...util_1.getDefaultWorld() });
        expect(result.ok).toBe(true);
        const asXunit = new AsXUnit_1.default();
        const res = await asXunit.getOutput(result, {});
        const obj = convert(res, { format: 'object' });
        expect(obj.testsuites.testsuite.testcase['@name']).toBeDefined();
        expect(obj.testsuites['@tests']).toBe('1');
        expect(obj.testsuites.testsuite.testcase.failure).toBeUndefined();
    });
    it('transforms multi type result to xunit', async () => {
        const base = process.cwd() + '/test/projects/specl/multiple';
        const specl = util_1.getOptionsOrDefault(base);
        const { result } = await run_1.run({ specl, base, addSteppers: [TestSteps_1.TestSteps], ...util_1.getDefaultWorld() });
        expect(result.ok).toBe(false);
        const asXunit = new AsXUnit_1.default();
        const res = await asXunit.getOutput(result, {});
        const obj = convert(res, { format: 'object' });
        expect(obj.testsuites.testsuite.testcase.length).toBe(2);
        expect(obj.testsuites['@tests']).toBe('2');
        expect(obj.testsuites['@failures']).toBe('1');
        expect(obj.testsuites.testsuite.testcase[0].failure).toBeDefined();
        expect(obj.testsuites.testsuite.testcase[1].failure).toBeUndefined();
    });
});
//# sourceMappingURL=AsXUnit.test.js.map