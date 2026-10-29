import { describe, expect, it } from "vitest";
import { AStepper, type TStepperSteps } from "../../steps/domains/stepper.js";
import { OK } from "../../domains/protocol.js";
import { passWithDefaults } from "../../test/lib.js";
import { LogicStepper } from "../../test/logic-stepper.js";
import { DOMAIN_FILE_DATA } from "../../domains/media-object.js";
import { TEST_STEP } from "../../test/test-step.js";

const NOTE = "hello";
const NOTE_DATA = `data:text/plain;base64,${Buffer.from(NOTE).toString("base64")}`;

/** A step that takes a file's data, as a step that keeps a file a person adds does. */
class KeepsAFile extends AStepper {
	description = "Keeps a file.";
	steps: TStepperSteps = { keep: { description: TEST_STEP, gwta: `keep {file: ${DOMAIN_FILE_DATA}}`, action: () => OK } };
}

describe("a value of a domain that declares what a record states for it", () => {
	it("is stated in the step's record by the file's type and size, not by its bytes", async () => {
		const result = await passWithDefaults(`keep "${NOTE_DATA}"`, [KeepsAFile, LogicStepper]);
		const [step] = result.featureResults?.[0]?.stepResults ?? [];
		expect(step?.in).toBe(`keep "a text/plain file of ${NOTE.length} bytes"`);
		expect(JSON.stringify(result.featureResults), "the bytes aren't in any record of the step").not.toContain(NOTE_DATA);
	});
});
