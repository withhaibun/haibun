import { describe, it, expect } from "vitest";
import { fileURLToPath } from "url";
import { use } from "./module-loader.js";
import VariablesStepper from "../../../steps/variables-stepper.js";

describe("use", () => {
	it("imports a stepper a config names by its file, extension and all, as a stepper kept in TypeScript source is named", async () => {
		const source = fileURLToPath(new URL("../../../steps/variables-stepper.ts", import.meta.url));
		expect((await use(source)).name).toBe(VariablesStepper.name);
	});
});
