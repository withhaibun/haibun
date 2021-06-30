"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const xmlbuilder2_1 = require("xmlbuilder2");
const os_1 = require("os");
class AsXUnit {
    async getOutput(result, { name = 'Haibun-Junit', prettyPrint = true, classname = 'Haibun-Junit-Suite' }) {
        const failures = result.results?.filter((t) => !t.ok)?.length;
        const skipped = result.results?.filter((t) => t.skip)?.length;
        const count = result.results?.length;
        const forXML = {
            testsuites: {
                '@tests': count,
                '@name': name,
                '@failures': failures,
                testsuite: {
                    '@name': classname,
                    '@tests': count,
                    '@skipped': skipped,
                    '@failures': failures,
                    testcase: [],
                },
            },
        };
        if (!result.results) {
            return;
        }
        for (const t of result.results) {
            const testCase = {
                '@name': t.path,
                '@id': t.path,
            };
            if (!t.ok) {
                testCase.failure = this.getFailResult(t.stepResults.find(r => !r.ok)?.actionResults.find(a => !a.ok));
            }
            if (t.comments) {
                testCase['system-out'] = t.comments;
            }
            forXML.testsuites.testsuite.testcase.push(testCase);
        }
        return xmlbuilder2_1.create(forXML).end({ prettyPrint, newline: os_1.EOL });
    }
    getFailResult(failure) {
        const failResult = {
            '@message': `${failure.name}: ${failure.message}`,
            '@type': 'fail',
        };
        return failResult;
    }
}
exports.default = AsXUnit;
//# sourceMappingURL=AsXUnit.js.map