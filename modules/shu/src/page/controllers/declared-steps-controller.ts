/**
 * Every step actuality declares, whether or not this page may call it: what the step view reads for a step the page can't
 * call, and what the action view reads for an action that doesn't allow a step the page may call.
 */
import { productData } from "@haibun/core/lib/domains/protocol.js";
import { lackedAction, type TAction } from "@haibun/core/lib/domains/actions.js";
import type { TStepMethod } from "@haibun/core/lib/steps/domains/step-method.js";
import { DeclaredStepsSchema, SHOW_DECLARED_STEPS_METHOD, type TDeclaredStep } from "@haibun/core/lib/steps/domains/declared-steps.js";
import { callStep } from "./read-controller.js";
import { holderOf, pageHolds, type THolder } from "./authority-controller.js";
import { outcomeOf, type TCallOutcome } from "../pipelines/call-step.js";

/** A step this page can't call: the step as actuality declares it, the action the page lacks to call it, and who holds that
 *  action here. */
export type TUncallableStep = { declared: TDeclaredStep; lacked: TAction; holder: THolder };

/** Every step actuality declares, or the refusal of the read. */
async function declaredSteps(why: string): Promise<TCallOutcome<TDeclaredStep[]>> {
	const read = await callStep<Record<string, unknown>>(SHOW_DECLARED_STEPS_METHOD, {}, why);
	return read.ok ? { ok: true, value: DeclaredStepsSchema.parse(productData(read.value)).steps } : read;
}

/** The step `method` names, which this page can't call, or the refusal of the read. Refuses a method actuality doesn't
 *  declare, and a declared step the page may call, which the page's steps hold. */
export async function uncallableStep(method: TStepMethod): Promise<TCallOutcome<TUncallableStep>> {
	const declared = await declaredSteps(`the declaration of ${method}`);
	if (!declared.ok) return declared;
	return outcomeOf(async () => {
		const step = declared.value.find((one) => one.method === method);
		if (step === undefined) throw new Error(`actuality doesn't declare ${method}; choose a step from the actions bar's step input`);
		const lacked = lackedAction(pageHolds(), step);
		if (lacked === undefined) throw new Error(`this page may call ${method}; read actuality again`);
		return { declared: step, lacked, holder: await holderOf(lacked) };
	});
}

/** The steps actuality declares that require `action`, or the refusal of the read. */
export async function stepsRequiring(action: TAction): Promise<TCallOutcome<TDeclaredStep[]>> {
	const declared = await declaredSteps(`the steps that require ${action}`);
	return declared.ok ? { ok: true, value: declared.value.filter((step) => step.capability === action) } : declared;
}
