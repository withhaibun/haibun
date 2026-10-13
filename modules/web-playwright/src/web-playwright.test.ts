import { describe, it, expect } from "vitest";
import path from "path";

import { getPackageLocation } from "@haibun/core/lib/util/node/workspace-lib.js";

import { getCreateSteppers } from "@haibun/core/lib/test/lib.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";

const me = path.join(getPackageLocation(import.meta).replace(/\/src$/, "/build"), "web-playwright-stepper");

describe("playwrightWeb", () => {
	it("sets up steps", async () => {
		const steppers = await getCreateSteppers([me]);
		expect(Object.keys(itemAt(steppers, 0).steps).length > 0).toBe(true);
		expect(Object.values(itemAt(steppers, 0).steps).every((s) => !!s.action)).toBe(true);
	});
});
