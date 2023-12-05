import { describe, it, expect } from 'vitest';

import { convert } from 'xmlbuilder2';

import OutXUnit from "./out-xunit.js";
import { testWithDefaults } from "@haibun/core/build/lib/test/lib.js";
import TestSteps from "@haibun/core/build/lib/test/TestSteps.js";
import { getOutputResult } from "@haibun/core/build/lib/util/workspace-lib.js";

const ox = [process.cwd(), "build", "out-xunit"].join("/");

describe("AsXML transforms", () => {
  it("transforms single pass result to xunit", async () => {
    const features = [{ path: '/features/fails.feature', content: `When I have a test\nThen passes` }];
    const result = await testWithDefaults(features, [TestSteps]);

    expect(result.ok).toBe(true);
    const asXunit = new OutXUnit();
    const res = await asXunit.getOutput(result, {});

    const obj: any = convert(res, { format: "object" });
    expect(obj.testsuites.testsuite.testcase["@name"]).toBeDefined();
    expect(obj.testsuites["@tests"]).toBe("1");
    expect(obj.testsuites.testsuite.testcase.failure).toBeUndefined();
  });
  it("transforms multi type result to xunit", async () => {
    const features = [{ path: '/features/fails.feature', content: `When I have a test\nThen fails` }, { path: '/features/passes.feature', content: `When I have a test\nThen passes` }];
    const result = await testWithDefaults(features, [TestSteps]);

    expect(result.ok).toBe(false);
    const asXunit = new OutXUnit();
    const res = await asXunit.getOutput(result, {});
    const obj: any = convert(res, { format: "object" });

    expect(obj.testsuites.testsuite.testcase.length).toBe(2);
    expect(obj.testsuites["@tests"]).toBe("2");
    expect(obj.testsuites["@failures"]).toBe("1");
    expect(obj.testsuites.testsuite.testcase[0].failure).toBeDefined();
    expect(obj.testsuites.testsuite.testcase[1].failure).toBeUndefined();
  });
});

it("run AsXUnit", async () => {
  const features = [{ path: '/features/fails.feature', content: `When I have a test\nThen fails` }, { path: '/features/passes.feature', content: `When I have a test\nThen passes` }];
  const result = await testWithDefaults(features, [TestSteps]);

  expect(result.ok).toBe(false);
  const output = await getOutputResult(ox, result);
  expect(typeof output).toBe('string');
  expect((<string>output).startsWith("<?xml")).toBeTruthy();
});