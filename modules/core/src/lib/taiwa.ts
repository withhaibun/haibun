/**
 * taiwa — contract for a stepper that responds to ask, plus runtime discovery
 * via `StepperKinds.TAIWA`. A stepper qualifies when `kind === StepperKinds.TAIWA`
 * and `ask(prompt, opts?)` is defined.
 *
 * Schemas at the boundary: KihanSchema describes a selectable POV (specialist);
 * AskOptionsSchema validates per-call options; AskChunkSchema validates streamed
 * response chunks. Server providers and SPA consumers parse through these so wire
 * shapes stay aligned.
 */

import { z } from "zod";
import { AStepper, StepperKinds } from "./astepper.js";

export const KihanSchema = z.object({
	id: z.string(),
	provider: z.string(),
	model: z.string(),
	isDefault: z.boolean(),
	contextSize: z.number().optional(),
});
export type TKihan = z.infer<typeof KihanSchema>;

export const KihanListSchema = z.object({
	kihan: z.array(KihanSchema),
	active: z.object({ provider: z.string(), model: z.string() }),
});
export type TKihanList = z.infer<typeof KihanListSchema>;

export const AskOptionsSchema = z.object({
	kihan: z.string().optional(),
	system: z.string().optional(),
	budget: z.number().optional(),
	timeoutMs: z.number().optional(),
});
export type TAskOptions = z.infer<typeof AskOptionsSchema> & {
	signal?: AbortSignal;
};

export const AskChunkSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("status"), status: z.string() }),
	z.object({ kind: z.literal("text"), text: z.string() }),
	z.object({ kind: z.literal("error"), error: z.string() }),
]);
export type TAskChunk = z.infer<typeof AskChunkSchema>;

export interface ITaiwa {
	ask(prompt: string, opts?: TAskOptions): Promise<string>;
}

/**
 * Return the single taiwa-bridge among `steppers`, or undefined if none.
 * Throws when more than one taiwa stepper is loaded (ambiguity must be
 * resolved explicitly) or when the TAIWA-kinded stepper doesn't
 * implement `ask`.
 */
export function findTaiwa(steppers: AStepper[]): ITaiwa | undefined {
	const matches = steppers.filter((s) => s.kind === StepperKinds.TAIWA);
	if (matches.length === 0) return undefined;
	if (matches.length > 1) {
		const names = matches.map((s) => s.constructor.name).join(", ");
		throw new Error(`Multiple taiwa steppers loaded (${names}); deployments must pick one.`);
	}
	const candidate = matches[0] as unknown as Partial<ITaiwa>;
	if (typeof candidate.ask !== "function" || candidate.ask.length < 1) {
		throw new Error(`${matches[0].constructor.name} declares kind=${StepperKinds.TAIWA} but does not implement ask(prompt, opts?).`);
	}
	return candidate as ITaiwa;
}
