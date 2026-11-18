/**
 * A call of a step by its name or its link (CA4F4): the page reads actuality's steps, finds the step, and follows its link
 * through the conduit. A page that carries a record of actuality returns, for a call without arguments, what the step
 * produced then, since a step without arguments produces the same thing again and the page doesn't have a site to call. A
 * call returns what the step returned, or the refusal.
 */
import type { z } from "zod";
import type { TCallLink } from "@haibun/core/lib/domains/hypermedia.js";
import { parsedAnswer } from "@haibun/core/lib/rpc-wire.js";
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

/** Where a carried record's products come from, as a refusal of them names it. */
const CARRIED_RECORD = "the record of actuality this page carries";

/** Calls the step `step` names with `params`, and returns what the step returned, parsed by `schema`, or the refusal. `why`
 *  states the call to the conduit's reports. A carried record's products are parsed by the same schema as a call's. */
export const callStep = <S extends z.ZodType>(scope: TCallScope, step: string, params: Record<string, unknown>, why: string, schema: S): Promise<TCallOutcome<z.output<S>>> =>
	outcomeOf(async () => {
		const list = await scope.steps();
		const method = Steps.methodOf(list, step);
		const carried = Object.keys(params).length === 0 ? scope.carried(method) : undefined;
		return carried !== undefined ? parsedAnswer(method, CARRIED_RECORD, schema, carried) : await scope.conduit().follow(Steps.linkOf(list, method, params, undefined), why, schema);
	});

/** Follows a call a record links, as its link names it, and returns what the call returned, parsed by `schema`. Throws the call's
 *  failure, so the reader that followed it states it. */
export async function followCall<S extends z.ZodType>(scope: TCallScope, link: TCallLink, why: string, schema: S): Promise<z.output<S>> {
	const list = await scope.steps();
	return await scope.conduit().follow(Steps.linkOf(list, link.method, link.params, link.summary), why, schema);
}

/** Returns the outcome of a read that throws its failure: what it returned, or its failure as the page's refusal. */
export async function outcomeOf<T>(read: () => Promise<T>): Promise<TCallOutcome<T>> {
	try {
		return { ok: true, value: await read() };
	} catch (err) {
		return { ok: false, refusal: refusalOf(err) };
	}
}
