/** The logic engine's stepper, which a test of core lists in its steppers as a configuration lists it. It loads by the path a
 *  configuration names, since @haibun/logic depends on core and core doesn't import it. A test of another module imports it. */
import { getSteppers } from "../adapters/workspace-lib.js";
import { LOGIC_STEPPER } from "../domains/protocol.js";
import type { CStepper } from "../steps/domains/stepper.js";

const [loaded] = await getSteppers([LOGIC_STEPPER]);
if (loaded === undefined) throw new Error(`${LOGIC_STEPPER} didn't load; install @haibun/logic`);
export const LogicStepper: CStepper = loaded;
