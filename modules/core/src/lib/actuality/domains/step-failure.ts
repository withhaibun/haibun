/**
 * The failure of a step that is the actuality's own, or of a phase that failed before the features ended, as the actuality
 * machine holds it and a reader of a run's events states it.
 */
import { z } from "zod";

/** A step that ended without completing, where its failure is the actuality's own, or the phase that ended the actuality:
 *  its id, and its text or the phase's name and why it failed where its end states them. */
export const StepFailureSchema = z.object({ id: z.string(), step: z.string().optional(), message: z.string().optional() });
export type TStepFailure = z.infer<typeof StepFailureSchema>;
