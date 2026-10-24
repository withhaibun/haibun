/**
 * The steppers actuality loads, as `show steppers` returns them and the CLI's `--show-steppers` prints them. The page doesn't
 * read them, so this module stays apart from the declarations every caller reads.
 */
import { z } from "zod";
import { CountedFields } from "../../domains/hypermedia.js";

export const SHOW_STEPPERS_LINE = "show steppers";
/** The product domain of `show steppers`, which holds a list. */
export const DOMAIN_STEPPERS = "steppers";

/** Each stepper actuality loads, with what it does and each of its steps as its key and its pattern: what `show steppers`
 *  returns and what the CLI's `--show-steppers` prints. */
export const SteppersSchema = z
	.object({ steppers: z.array(z.object({ stepper: z.string(), description: z.string(), steps: z.array(z.string()) }).strict()), ...CountedFields })
	.strict();
export type TSteppers = z.infer<typeof SteppersSchema>;
