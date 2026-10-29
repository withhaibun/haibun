/**
 * The steppers actuality loads, as the CLI's `--show-steppers` prints them. `show steps` lists the steppers of the steps it
 * lists, so a caller of actuality reads them there; this module stays apart from the declarations every caller reads.
 */
import { z } from "zod";
import { CountedFields } from "../../domains/hypermedia.js";

/** Each stepper actuality loads, with what it does and each of its steps as its key and its pattern: what the CLI's
 *  `--show-steppers` prints. */
export const SteppersSchema = z
	.object({ steppers: z.array(z.object({ stepper: z.string(), description: z.string(), steps: z.array(z.string()) }).strict()), ...CountedFields })
	.strict();
export type TSteppers = z.infer<typeof SteppersSchema>;
