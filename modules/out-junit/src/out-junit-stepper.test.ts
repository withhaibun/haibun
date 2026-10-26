import { describe, it, expect } from "vitest";

import { convert } from "xmlbuilder2";

import OutJUnit from "./out-junit-stepper.js";
import { failWithDefaults, passWithDefaults } from "@haibun/core/lib/test/lib.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import TestSteps from "@haibun/core/lib/test/TestSteps.js";

describe("AsXML transforms", () => {
	it("transforms single pass result to junit", async () => {
		const features = [{ path: "/features/fails.feature", content: `When I have a test\nThen passes` }];
		const result = await passWithDefaults(features, [TestSteps, LogicStepper]);

		expect(result.ok).toBe(true);
		const asJUnit = new OutJUnit();
		const res = await asJUnit.featureResultAsJunit(result);

		const obj = convert(res, { format: "object" });
		expect(obj).toHaveProperty(["testsuites", "testsuite", "testcase", "@name"]);
		expect(obj).toHaveProperty(["testsuites", "@tests"], "1");
		expect(obj).not.toHaveProperty(["testsuites", "testsuite", "testcase", "failure"]);
	});
	it("transforms multi type result to junit", async () => {
		const features = [
			{ path: "/features/passes.feature", content: `When I have a test\nThen passes` },
			{ path: "/features/fails.feature", content: `When I have a test\nThen fails` },
		];
		const result = await failWithDefaults(features, [TestSteps, LogicStepper]);

		expect(result.ok).toBe(false);
		const asJUnit = new OutJUnit();
		const res = await asJUnit.featureResultAsJunit(result);
		const obj = convert(res, { format: "object" });

		expect(obj).toHaveProperty(["testsuites", "testsuite", "testcase", "length"], 2);
		expect(obj).toHaveProperty(["testsuites", "@tests"], "2");
		expect(obj).toHaveProperty(["testsuites", "@failures"], "1");
		expect(obj).not.toHaveProperty(["testsuites", "testsuite", "testcase", 0, "failure"]);
		expect(obj).toHaveProperty(["testsuites", "testsuite", "testcase", 1, "failure"]);
	});
});
