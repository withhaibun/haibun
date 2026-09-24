/**
 * What a step requires, and what an action a caller holds allows. One reading, shared by the boundary that checks a
 * call, the statement that narrows one and a page choosing which of its delegations to sign a call with, so none of
 * them can allow what another refuses. Free of node imports, since a page reads it too.
 */
import { ACCESS_BROADEST_FIRST, Access, AccessLevelSchema, narrowerAccess, type AccessLevel } from "./resources.js";

const READ_PREFIX = "Read:";

/** The actions a comma-separated list names, as a feature, an option or a delegation writes them. */
export function actionList(listed: string | undefined): string[] {
	return (listed ?? "")
		.split(",")
		.map((action) => action.trim())
		.filter((action) => action.length > 0);
}

/** The action a read at `level` requires. */
export const readAction = (level: AccessLevel): string => `${READ_PREFIX}${level}`;

/** The level a read action names, or undefined for any other action. */
function readLevelOf(action: string): AccessLevel | undefined {
	if (!action.startsWith(READ_PREFIX)) return undefined;
	const parsed = AccessLevelSchema.safeParse(action.slice(READ_PREFIX.length));
	return parsed.success ? parsed.data : undefined;
}

/**
 * The action a step requires: the one it declares; `Read:public` for a step that declares itself a read, since reading at
 * any level allows a public read; and for any other, the step's own name, so a step nobody declared anything for is
 * refused to every caller not given it by name.
 */
export function requiredAction(stepperName: string, stepName: string, step: { capability?: string; read?: boolean }): string {
	return step.capability ?? (step.read ? readAction(Access.public) : `${stepperName}:${stepName}`);
}

/** Whether a caller holding `held` may call `step`: what it holds allows the action the step requires. Every gate on a
 *  call and every listing of steps for a caller reads this. */
export function mayCall(held: string | string[] | undefined, step: { capability: string }): boolean {
	return capabilityAllows(held, step.capability);
}

/**
 * Whether what a caller holds allows `required`: the action itself, `*`, a prefix ending in `*`, or a read at a level at
 * least as broad as the one asked for, since a reader who may see private records may see public ones.
 */
export function capabilityAllows(granted: string | string[] | undefined, required: string): boolean {
	if (!granted) return false;
	const asked = readLevelOf(required);
	return (Array.isArray(granted) ? granted : [granted]).some((entry) => {
		if (entry === "*" || entry === required) return true;
		if (entry.endsWith("*")) return required.startsWith(entry.slice(0, -1));
		const held = readLevelOf(entry);
		return held !== undefined && asked !== undefined && narrowerAccess(held, asked) === asked;
	});
}

/** The broadest level what a caller holds lets it read at, or undefined where it holds no read. */
export function readCeilingOf(granted: string | string[] | undefined): AccessLevel | undefined {
	return ACCESS_BROADEST_FIRST.find((level) => capabilityAllows(granted, readAction(level)));
}

/** What following a run's events requires: a read at the least level. Each event states the level of what it may
 *  reveal, and a follower is sent those it may read at that level. */
export const FOLLOWS_THE_RUN = readAction(Access.public);

/** A delegation as its holder presents it: what it lets the holder do, over what, and until when. */
export type TDelegation = Record<string, unknown> & { allowedAction?: unknown; invocationTarget?: unknown; expires?: unknown };

/** Every action: what the run holds, and what a delegation that restricts no action allows. */
export const EVERY_ACTION = "*";

/** The actions a delegation allows: those it lists, or every action where it lists none, which is how zcap-LD writes a
 *  delegation that restricts no action. */
export function delegatedActions(delegation: { allowedAction?: unknown }): string[] {
	const listed = delegation.allowedAction;
	if (listed === undefined) return [EVERY_ACTION];
	return (Array.isArray(listed) ? listed : [listed]).filter((action): action is string => typeof action === "string");
}

/** What a delegation of `actions` lists: nothing where they allow every action, since zcap-LD narrows a delegation by the
 *  exact actions its parent lists and reads a listed `*` as an action's name. */
export function allowedActionFor(actions: string[]): string[] | undefined {
	return actions.includes(EVERY_ACTION) ? undefined : actions;
}

/**
 * The action a holder invokes under `delegation` for a call requiring `required` at `target`, where the delegation allows
 * it now: one it lists that allows `required`, the target at or under the one it is over, and its expiry ahead. A
 * delegation is matched on exactly what it lists, so the action invoked is one it names, not the one required.
 */
export function actionUnder(delegation: TDelegation, required: string, target: string, now = Date.now()): string | undefined {
	const over = typeof delegation.invocationTarget === "string" ? delegation.invocationTarget : undefined;
	const expires = typeof delegation.expires === "string" ? Date.parse(delegation.expires) : Number.NaN;
	if (!over || !(target === over || target.startsWith(over.endsWith("/") ? over : `${over}/`)) || !(expires > now)) return undefined;
	// A delegation that restricts no action is invoked for the action required itself.
	if (delegation.allowedAction === undefined) return required;
	return delegatedActions(delegation).find((action) => capabilityAllows(action, required));
}
