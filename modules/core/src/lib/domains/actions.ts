/**
 * Computes the action a step requires and whether the actions a caller holds allow it. Three callers import these
 * functions: the boundary that checks a call, the statement that narrows a delegation, and a page that selects the
 * delegation for signing a call. Each applies the same rules, so one of them can't allow an action another refuses. The
 * module doesn't import a node module, because a page imports it too.
 */
import { z } from "zod";
import { ACCESS_BROADEST_FIRST, Access, AccessLevelSchema, narrowerAccess, type AccessLevel } from "./resources.js";

const READ_PREFIX = "Read:";
const WRITE_PREFIX = "Write:";

/** Returns the actions a comma-separated list names. A feature, an option and a delegation write actions in this form. */
export function actionList(listed: string | undefined): string[] {
	if (listed === undefined) return [];
	return listed
		.split(",")
		.map((action) => action.trim())
		.filter((action) => action.length > 0);
}

/** The grammar of an action: every action (`*`), a name such as `store.read`, a stepper's name and one of its steps or a read's
 *  level after a colon, such as `Read:public`, or a prefix that a trailing `*` ends, which allows every action it begins. */
const ACTION_GRAMMAR = /^(\*|[A-Za-z][\w.-]*(:[\w.-]*)?\*?)$/;

/** An action as a reader states it: what a caller holds or a step requires. A reference to an action takes one, so a step's
 *  method isn't taken for an action. An action a link, a call, a delegation or a step's declaration states is parsed with its
 *  grammar, and a refusal states the grammar's pattern; one this module builds is stated in that grammar. */
export const ActionSchema = z.string().regex(ACTION_GRAMMAR).brand<"Action">();
export type TAction = z.infer<typeof ActionSchema>;
/** The actions a caller held for a step, read from the comma-separated list a record states them in, each in an action's grammar. */
export const heldActions = (held: string): TAction[] => actionList(held).map((action) => ActionSchema.parse(action));

/** The action a read at `level` requires. */
export const readAction = (level: AccessLevel): TAction => `${READ_PREFIX}${level}` as TAction;

/** The read action a reader holds to open a record, at the level the record states. */
export const recordReadAction = (record: { accessLevel: AccessLevel }): TAction => readAction(record.accessLevel);

/** The level a read action names, or undefined for any other action. */
function readLevelOf(action: string): AccessLevel | undefined {
	if (!action.startsWith(READ_PREFIX)) return undefined;
	const parsed = AccessLevelSchema.safeParse(action.slice(READ_PREFIX.length));
	return parsed.success ? parsed.data : undefined;
}

/** What a step reads and the action it requires.
 *  - `read`: the step reads actuality's records and doesn't change one. A call into a running instance from outside
 *    actuality runs it and doesn't record it: it doesn't leave a step record, an announcement, a usage count or a kept
 *    result. Reading actuality isn't a step of actuality, so an instance read for a year doesn't write a year of records of
 *    those reads. A feature runs it as it runs any other step.
 *  - `capability`: the action a caller must hold to run the step, where it differs from the step's own name. A group of
 *    steps declares one action, so a delegation can name them together.
 *  - `readsAt`: the level of the content the step reads. A gate refuses the step to a caller that doesn't hold a read at
 *    this level. A read step states it, or states the capability that gates it. */
export type TStepReads =
	| { read?: boolean; capability: string; readsAt?: AccessLevel }
	| { read?: boolean; capability?: string; readsAt: AccessLevel }
	| { read?: false; capability?: string; readsAt?: undefined };

/**
 * Returns the action a step requires. A step that declares a capability requires that action. A read step without one
 * requires a read at its `readsAt` level. Any other step requires its own name, so a gate refuses a step that doesn't
 * declare a requirement to every caller that doesn't hold that name.
 */
export function requiredAction(stepperName: string, stepName: string, step: TStepReads): TAction {
	if (step.capability !== undefined) return ActionSchema.parse(step.capability);
	if (!step.read) return `${stepperName}:${stepName}` as TAction;
	if (step.readsAt === undefined) throw new Error(`${stepperName}.${stepName} reads and doesn't state readsAt or a capability. State readsAt as the level of its read.`);
	return readAction(step.readsAt);
}

/** The fields a gate or a listing reads from a step: the action the step requires, and its `readsAt` level where it states one. */
type TCalled = { capability: TAction; readsAt?: AccessLevel };

/** Returns the action a caller holding `held` lacks to call `step`. That is the step's required action, or else a read at
 *  the step's `readsAt` level. Returns undefined where the caller holds both. */
export function lackedAction(held: string | string[] | undefined, step: TCalled): TAction | undefined {
	if (!capabilityAllows(held, step.capability)) return step.capability;
	if (step.readsAt && !capabilityAllows(held, readAction(step.readsAt))) return readAction(step.readsAt);
	return undefined;
}

/** The authority of one call. `invoked` is the action the call invoked. `held` is what its caller holds, and bounds what the
 *  call reads under the invoked action. */
export type TCallAuthority = { invoked: string | string[] | undefined; held: string | string[] | undefined };

/**
 * Returns the action a call lacks to run `step`. The call must have invoked the action the step requires, and its caller
 * must hold a read at the step's `readsAt` level. ZCAP-LD authorizes an invocation for the one action it names. The
 * chain the caller presented bounds what the step reads under that action. Returns undefined where the call has both.
 */
export function lackedByCall(call: TCallAuthority, step: TCalled): string | undefined {
	if (!capabilityAllows(call.invoked, step.capability)) return step.capability;
	if (step.readsAt && !capabilityAllows(call.held, readAction(step.readsAt))) return readAction(step.readsAt);
	return undefined;
}

/** Returns whether a caller holding `held` may call `step`. It returns true where `lackedAction` returns undefined. A
 *  listing of a caller's steps calls this function, and so does a gate that reads only what a caller holds. A gate on an
 *  invoked call calls `lackedByCall`. */
export function mayCall(held: string | string[] | undefined, step: TCalled): boolean {
	return lackedAction(held, step) === undefined;
}

/**
 * Returns whether what a caller holds allows `required`. An entry allows it where the entry is the action itself, `*`, or
 * a prefix ending in `*` that matches it. A read entry allows a read at its own level and at each narrower level, since a
 * reader who may see private records may see public ones.
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

/** Returns the broadest read level that a caller's actions allow, or undefined where it doesn't hold a read. */
export function readCeilingOf(granted: string | string[] | undefined): AccessLevel | undefined {
	return ACCESS_BROADEST_FIRST.find((level) => capabilityAllows(granted, readAction(level)));
}

/** The action that following actuality's events requires. It is a read at the narrowest level. Each event states the
 *  level of the content it reveals, and a follower receives the events its read level allows. */
export const FOLLOWS_THE_RUN = readAction(Access.public);

/** The action that reading actuality's artifacts requires. It is a private read. A capture records the pages that
 *  actuality's steps opened, and one of those pages can be a person's own page. */
export const READS_THE_RUNS_ARTIFACTS = readAction(Access.private);

/** The action that reading a served folder's files requires. It is a read at the narrowest level: a deployment serves a
 *  site to every browser by allowing it without a delegation. */
export const READS_A_SERVED_FOLDER = readAction(Access.public);

/** Returns the action that writing a record at `level` requires where `level` is more public than the writer's read
 *  level. Such a write exposes what the writer read to more readers. A caller holds it only by the action's name or by an
 *  entry ending in `*` that matches it. */
export const writeAction = (level: AccessLevel): string => `${WRITE_PREFIX}${level}`;

/** The bounds on a caller. `ceiling` is the broadest level it may read, and is undefined where a ceiling doesn't bound
 *  the caller. `held` is the actions it holds. */
export type TAccessBound = { ceiling: AccessLevel | undefined; held: string | string[] | undefined };

/** Returns the level that bounds a read requesting `asked`. It is `asked` narrowed to the caller's ceiling. Every store
 *  bounds every read by this level, and returns a record where `withinAccess` holds for the record at this level. */
export function seenAt(asked: AccessLevel, ceiling: AccessLevel | undefined): AccessLevel {
	return ceiling ? narrowerAccess(asked, ceiling) : asked;
}

/**
 * Returns the level of a written record. Every store writes at this level. A write that a ceiling doesn't bound is
 * actuality's own, and takes the stated level or else the declared one. A bounded write takes the level the record
 * states, or else the narrower of the type's declared level and the writer's ceiling, so a writer reads back what it
 * wrote. A writer can copy what it read into what it writes, so a level more public than its ceiling requires
 * `writeAction` of that level. A writer that lacks that action is refused a stated level, and receives its ceiling in
 * place of a declared level. A write that doesn't state a level of a type that doesn't declare one is refused.
 */
export function writtenAt(stated: AccessLevel | undefined, declared: AccessLevel | undefined, bound: TAccessBound): AccessLevel {
	const { ceiling } = bound;
	if (stated !== undefined) {
		if (!ceiling || mayWriteAt(stated, bound)) return stated;
		throw new Error(
			`writing at ${stated} requires ${writeAction(stated)}. The caller doesn't hold it and reads at ${ceiling}. Write at that level or a more private one, or hold the action.`,
		);
	}
	if (declared === undefined)
		throw new Error(
			"a write that doesn't state a level is refused, and the record's type doesn't declare one. State accessLevel on the record, or declare its type with accessLevel.",
		);
	if (!ceiling) return declared;
	const level = narrowerAccess(ceiling, declared);
	return mayWriteAt(level, bound) ? level : ceiling;
}

/** Returns whether `writtenAt` writes at every level a caller states. It does where a ceiling doesn't bound the caller, or
 *  where the caller holds the write action of each level more public than its ceiling. A store calls this before it reads
 *  the level of the record a write targets. */
export function writesAtEveryLevel(bound: TAccessBound): boolean {
	return ACCESS_BROADEST_FIRST.every((level) => mayWriteAt(level, bound));
}

function mayWriteAt(level: AccessLevel, { ceiling, held }: TAccessBound): boolean {
	return !ceiling || narrowerAccess(ceiling, level) === ceiling || capabilityAllows(held, writeAction(level));
}

/** Returns the actions that reading at `ceiling` and writing records at each of `levels` require. They are the read, and
 *  the write action of each level more public than the ceiling. */
export function actionsToReadAndWrite(ceiling: AccessLevel, levels: AccessLevel[]): string[] {
	const moreOpen = [...new Set(levels)].filter((level) => !mayWriteAt(level, { ceiling, held: undefined }));
	return [readAction(ceiling), ...moreOpen.map(writeAction)];
}

/** A delegation as its holder presents it. `allowedAction` lists the actions it allows, `invocationTarget` names the target
 *  it covers, and `expires` states when it ends. */
export type TDelegation = Record<string, unknown> & { allowedAction?: unknown; invocationTarget?: unknown; expires?: unknown };

/** What a containment holds within its bound, as ODRL reads a capability: the actions it allows, the target it covers, when it
 *  ends, and the time of its use. A delegation, a grant and a call are each one. */
export type TPermission = { actions: readonly string[]; target?: string; expires?: string; usedAt?: string };

/** What a candidate holds beyond its bound: an action, a target, or an expiry or a time of use past the bound's expiry. */
export const EXCEEDS = { action: "action", target: "target", expires: "expires" } as const;
/** The expiry a candidate exceeds by where it doesn't end and its bound does. */
export const NEVER_EXPIRES = "never";
/** One witness of a candidate that exceeds its bound: what it holds beyond the bound, by kind. */
export type TExceeding = { kind: keyof typeof EXCEEDS; value: string };
/** The witness of a candidate that exceeds its bound, as a refusal names it. */
export const witnessOf = (exceeding: readonly TExceeding[]): string => exceeding.map(({ kind, value }) => `${kind} ${value}`).join(", ");

/** Returns the permission a delegation grants: the actions it allows, and its target and expiry where it states them. */
export function permissionOf(delegation: TDelegation): TPermission {
	const { invocationTarget: target, expires } = delegation;
	return { actions: delegatedActions(delegation), ...(typeof target === "string" ? { target } : {}), ...(typeof expires === "string" ? { expires } : {}) };
}

/** The entry that names every action. Actuality holds it, and a delegation that doesn't restrict an action allows it. */
export const EVERY_ACTION = "*";

/** Returns the actions a delegation allows. They are the actions it lists, or every action where it doesn't list one.
 *  zcap-LD writes a delegation that doesn't restrict an action without `allowedAction`. */
export function delegatedActions(delegation: { allowedAction?: unknown }): TAction[] {
	const listed = delegation.allowedAction;
	return z.array(ActionSchema).parse(listed === undefined ? [EVERY_ACTION] : (Array.isArray(listed) ? listed : [listed]).filter((action) => typeof action === "string"));
}

/** Returns the `allowedAction` that a delegation of `actions` lists. It is undefined where `actions` includes
 *  `EVERY_ACTION`, since zcap-LD narrows a delegation by the exact actions its parent lists and reads a listed `*` as an
 *  action's name. */
export function allowedActionFor(actions: string[]): string[] | undefined {
	return actions.includes(EVERY_ACTION) ? undefined : actions;
}

/**
 * Returns the action a holder invokes under `delegation` for a call that requires `required` at `target`. The delegation
 * allows the call where it lists an action that allows `required` or doesn't list an action, `target` is at or under its
 * `invocationTarget`, and its expiry is later than `now`. A delegation that lists actions is matched on those actions, so
 * the action invoked is one it names and can differ from `required`. Returns undefined where the delegation doesn't
 * allow the call.
 */
export function actionUnder(delegation: TDelegation, required: string, target: string, now = Date.now()): string | undefined {
	const over = typeof delegation.invocationTarget === "string" ? delegation.invocationTarget : undefined;
	const expires = typeof delegation.expires === "string" ? Date.parse(delegation.expires) : Number.NaN;
	if (!over || !(target === over || target.startsWith(over.endsWith("/") ? over : `${over}/`)) || !(expires > now)) return undefined;
	// A delegation that doesn't restrict an action is invoked for `required`.
	if (delegation.allowedAction === undefined) return required;
	return delegatedActions(delegation).find((action) => capabilityAllows(action, required));
}

/** What a holder delegates to another key. `parent` is the held delegation it narrows, `allowedAction` lists the new
 *  delegation's actions, and `expires` states when the new delegation ends. */
export type TNarrowing = { parent: TDelegation; allowedAction: string[] | undefined; expires: string };

/**
 * Returns how a holder narrows what it holds for another key. It selects the first held delegation that allows every
 * action in `to.wanted` at the target. The new delegation lists the parent's action that allows each requested action,
 * since zcap-LD narrows a delegation by the exact actions its parent lists. The new delegation ends at `to.expires`, or at
 * the parent's expiry where that is earlier. Returns undefined where every held delegation lacks one of the actions.
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

/** The actions on actuality's own authority. `delegate` permits stating and delegating the authority. `revoke` permits
 *  revoking a capability the authority granted. `name` permits naming the sites that connect to this instance. */
export const AUTHORITY_CAPABILITIES = { delegate: "Authority:delegate", revoke: "Authority:revoke", name: "Authority:name" } as const;
