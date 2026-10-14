/**
 * The actions a call holds, as a list: the capability context states one action, several, or an absent statement for a
 * call without an action.
 */

/** The actions `stated` names; an absent statement names an empty list. */
export const actionsOf = (stated: string | string[] | undefined): string[] => (stated === undefined ? [] : [stated].flat());
