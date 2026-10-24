/**
 * Every step actuality declares, whether or not its caller may call it: what a page shows of a step it can't call, the action
 * the step requires and whether the caller may call it, so a link to such a step or to the action it requires leads to why.
 */
import { z } from "zod";
import { CountedFields } from "../../domains/hypermedia.js";
import { StepDescriptorSchema } from "./step-discovery.js";

export const SHOW_DECLARED_STEPS_LINE = "show every step actuality declares";
export const SHOW_DECLARED_STEPS_METHOD = "Haibun-showDeclaredSteps";
/** The product domain of the read, which holds a list. */
export const DOMAIN_DECLARED_STEPS = "declared-steps";

/** A step as actuality declares it to any caller: its method, stepper, line and description, the action it requires and the
 *  level it reads at, and whether this caller may call it. */
const DeclaredStepSchema = StepDescriptorSchema.pick({ method: true, stepperName: true, pattern: true, description: true, capability: true, readsAt: true })
	.extend({ callable: z.boolean() })
	.strict();
export type TDeclaredStep = z.infer<typeof DeclaredStepSchema>;
export const DeclaredStepsSchema = z.object({ steps: z.array(DeclaredStepSchema), ...CountedFields }).strict();
export type TDeclaredSteps = z.infer<typeof DeclaredStepsSchema>;
