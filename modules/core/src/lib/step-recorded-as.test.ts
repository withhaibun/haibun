import { describe, expect, it } from "vitest";
import { AStepper, type TStepperSteps } from "./astepper.js";
import { OK } from "../schema/protocol.js";
import { passWithDefaults } from "./test/lib.js";
import { DOMAIN_FILE_DATA } from "./media-object.js";

const NOTE = "hello";
const NOTE_DATA = `data:text/plain;base64,${Buffer.from(NOTE).toString("base64")}`;

/** A step that takes a file's data, as a step that keeps a file a person adds does. */
class KeepsAFile extends AStepper {
	steps: TStepperSteps = {
		keep: { gwta: `keep {file: ${DOMAIN_FILE_DATA}}`, action: () => OK },
	};
}

describe("a value of a domain that declares what a record states for it", () => {
	it("is stated in the step's record by the file's type and size, not by its bytes", async () => {
		const result = await passWithDefaults(`keep "${NOTE_DATA}"`, [KeepsAFile]);
		const [step] = result.featureResults?.[0]?.stepResults ?? [];
		expect(step?.in).toBe(`keep "a text/plain file of ${NOTE.length} bytes"`);
		expect(JSON.stringify(result.featureResults), "the bytes aren't in any record of the step").not.toContain(NOTE_DATA);
	});
});
