/**
 * What a step requires, and what an action a caller holds allows. One reading, shared by the boundary that checks a
 * call, the statement that narrows one and a page choosing which of its delegations to sign a call with, so none of
 * them can allow what another refuses. Free of node imports, since a page reads it too.
 */
import { ACCESS_BROADEST_FIRST, Access, AccessLevelSchema, narrowerAccess, type AccessLevel } from "./resources.js";

const READ_PREFIX = "Read:";
const WRITE_PREFIX = "Write:";

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

/** The step a gate or a listing weighs: the action it requires, and the level of what it reads where it states one. */
type TCalled = { capability: string; readsAt?: AccessLevel };

/** The action a caller holding `held` lacks to call `step`: the one the step requires, or else a read at the level the
 *  step reads at. Undefined where it lacks neither. */
export function lackedAction(held: string | string[] | undefined, step: TCalled): string | undefined {
	if (!capabilityAllows(held, step.capability)) return step.capability;
	if (step.readsAt && !capabilityAllows(held, readAction(step.readsAt))) return readAction(step.readsAt);
	return undefined;
}

/** Whether a caller holding `held` may call `step`: it lacks no action the step requires. Every gate on a call and every
 *  listing of steps for a caller reads this. */
export function mayCall(held: string | string[] | undefined, step: TCalled): boolean {
	return lackedAction(held, step) === undefined;
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

/** The action writing a record at `level` requires where `level` is more public than what the writer may read: writing
 *  what it read where more readers see it. Held exactly, or through `*`. */
export const writeAction = (level: AccessLevel): string => `${WRITE_PREFIX}${level}`;

/** What bounds a caller: the most it may read, absent where nothing bounds it, and the actions it holds. */
export type TAccessBound = { ceiling: AccessLevel | undefined; held: string | string[] | undefined };

/** The level a read asking for `asked` sees: what it asked for, never more than its caller's ceiling. Every store bounds
 *  every read by this, and returns a record where `withinAccess` holds for it at this level. */
export function seenAt(asked: AccessLevel, ceiling: AccessLevel | undefined): AccessLevel {
	return ceiling ? narrowerAccess(asked, ceiling) : asked;
}

/**
 * The level a record is written at, which every store writes by: the level the record states, or else the narrower of the
 * level its type declares and the writer's ceiling, so a writer reads back what it wrote. What a writer read reaches what
 * it writes, so a level more public than its ceiling requires `writeAction` of that level: a stated level is refused
 * without it, and a declared one gives way to the ceiling. A write bounded by nothing is the run's own and takes the
 * level stated or declared.
 */
export function writtenAt(stated: AccessLevel | undefined, declared: AccessLevel, bound: TAccessBound): AccessLevel {
	const { ceiling } = bound;
	if (!ceiling) return stated ?? declared;
	const level = stated ?? narrowerAccess(ceiling, declared);
	if (mayWriteAt(level, bound)) return level;
	if (stated) throw new Error(`writing at ${stated} requires ${writeAction(stated)}: what is read at ${ceiling} is written more publicly only by a caller holding it`);
	return ceiling;
}

/** Whether `writtenAt` refuses a caller nothing: nothing bounds it, or it holds the write of every level more public than
 *  its ceiling. A store asks this before reading the level of a record a write goes into. */
export function writesAtEveryLevel(bound: TAccessBound): boolean {
	return ACCESS_BROADEST_FIRST.every((level) => mayWriteAt(level, bound));
}

function mayWriteAt(level: AccessLevel, { ceiling, held }: TAccessBound): boolean {
	return !ceiling || narrowerAccess(ceiling, level) === ceiling || capabilityAllows(held, writeAction(level));
}

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

/** What a holder delegates to another key: the delegation it holds that it narrows, the actions the new one lists, and
 *  when it ends. */
export type TNarrowing = { parent: TDelegation; allowedAction: string[] | undefined; expires: string };

/**
 * How a holder narrows what it holds for another key: from the first delegation it holds that allows every action wanted
 * at the target, listing for each the action that delegation lists that allows it, since zcap-LD narrows a delegation by
 * the exact actions its parent lists, and ending no later than that delegation does. Undefined where none allows them all.
 */
export function narrowing(held: TDelegation[], to: { wanted: string[]; expires: string; target: string }): TNarrowing | undefined {
	for (const parent of held) {
		const listed = to.wanted.map((action) => actionUnder(parent, action, to.target));
		if (listed.some((action) => action === undefined)) continue;
		const parentEnds = typeof parent.expires === "string" ? parent.expires : undefined;
		const expires = parentEnds && Date.parse(parentEnds) < Date.parse(to.expires) ? parentEnds : to.expires;
		return { parent, allowedAction: allowedActionFor([...new Set(listed as string[])]), expires };
	}
	return undefined;
}
