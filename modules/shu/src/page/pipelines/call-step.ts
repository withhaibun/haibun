/**
 * A call of a step by its name or its link (CA4F4): the page reads actuality's steps, finds the step, and follows its link
 * through the conduit. A page that carries a record of actuality returns, for a call without arguments, what the step
 * produced then, since a step without arguments produces the same thing again and the page doesn't have a site to call. A
 * call returns what the step returned, or the refusal.
 */
import type { TCallLink } from "@haibun/core/lib/domains/hypermedia.js";
import * as Steps from "../derivations/steps.js";
import { refusalOf } from "../derivations/refusal.js";
import type { TPageRefusal } from "../domains/refusal.js";
import type { TStepList } from "../machines/registry.js";
import type { TConduit } from "../ports.js";

/** What a call reads: actuality's steps, read where the page doesn't hold them, the conduit, and what a carried run's step
 *  produced, undefined where the page doesn't carry it. */
export type TCallScope = { steps: () => Promise<TStepList>; conduit: () => TConduit; carried: (method: string) => unknown };

/** What a write returned: that it wrote, or the refusal. */
export type TWritten = { ok: true } | { ok: false; refusal: TPageRefusal };

/** What a call returned: what the step returned, or the refusal. */
export type TCallOutcome<T> = { ok: true; value: T } | { ok: false; refusal: TPageRefusal };

/** Calls the step `step` names with `params`, and returns what the step returned, or the refusal. `why` states the call to the
 *  conduit's reports. */
export const callStep = <T>(scope: TCallScope, step: string, params: Record<string, unknown>, why: string): Promise<TCallOutcome<T>> =>
	outcomeOf(async () => {
		const list = await scope.steps();
		const method = Steps.methodOf(list, step);
		const carried = Object.keys(params).length === 0 ? scope.carried(method) : undefined;
		return carried !== undefined ? (carried as T) : await scope.conduit().follow<T>(Steps.linkOf(list, method, params, undefined), why);
	});

/** Follows a call a record links, as its link names it, and returns what the call returned. Throws the call's failure, so
 *  the reader that followed it states it. */
export async function followCall<T>(scope: TCallScope, link: TCallLink, why: string): Promise<T> {
	const list = await scope.steps();
	return await scope.conduit().follow<T>(Steps.linkOf(list, link.method, link.params, link.summary), why);
}

/** Returns the outcome of a read that throws its failure: what it returned, or its failure as the page's refusal. */
export async function outcomeOf<T>(read: () => Promise<T>): Promise<TCallOutcome<T>> {
	try {
		return { ok: true, value: await read() };
	} catch (err) {
		return { ok: false, refusal: refusalOf(err) };
	}
}
