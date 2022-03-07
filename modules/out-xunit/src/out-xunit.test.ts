const { convert } = require("xmlbuilder2");

import OutXUnit from "./out-xunit";
import { testWithDefaults } from "@haibun/core/build/lib/test/lib";
import TestSteps from "@haibun/core/build/lib/test/TestSteps";
import { resultOutput } from "@haibun/core/build/lib/util";

const ox = [process.cwd(), "build", "out-xunit"].join("/");

describe("AsXML transforms", () => {
  it("transforms single pass result to xunit", async () => {
    const features = [{ path: '/features/fails.feature', content: `When I have a test\nThen the test should pass` }];
    const result = await testWithDefaults(features, [TestSteps]);

    expect(result.ok).toBe(true);
    const asXunit = new OutXUnit();
    const res = await asXunit.getOutput(result, {});

    const obj = convert(res, { format: "object" });
    expect(obj.testsuites.testsuite.testcase["@name"]).toBeDefined();
    expect(obj.testsuites["@tests"]).toBe("1");
    expect(obj.testsuites.testsuite.testcase.failure).toBeUndefined();
  });
  it("transforms multi type result to xunit", async () => {
    const features = [{ path: '/features/fails.feature', content: `When I have a test\nThen the test can fail` }, { path: '/features/passes.feature', content: `When I have a test\nThen the test should pass` }];
    const result = await testWithDefaults(features, [TestSteps]);

    expect(result.ok).toBe(false);
    const asXunit = new OutXUnit();
    const res = await asXunit.getOutput(result, {});
    const obj = convert(res, { format: "object" });

    expect(obj.testsuites.testsuite.testcase.length).toBe(2);
    expect(obj.testsuites["@tests"]).toBe("2");
    expect(obj.testsuites["@failures"]).toBe("1");
    expect(obj.testsuites.testsuite.testcase[0].failure).toBeDefined();
    expect(obj.testsuites.testsuite.testcase[1].failure).toBeUndefined();
  });
});

it("run AsXUnit", async () => {
  const features = [{ path: '/features/fails.feature', content: `When I have a test\nThen the test can fail` }, { path: '/features/passes.feature', content: `When I have a test\nThen the test should pass` }];
  const result = await testWithDefaults(features, [TestSteps]);

  expect(result.ok).toBe(false);
  const output = await resultOutput(ox, result);
  expect(typeof output).toBe("string");
  expect(output.startsWith("<?xml")).toBeTruthy();
});
