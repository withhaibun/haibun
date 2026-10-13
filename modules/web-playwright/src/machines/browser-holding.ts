/**
 * What actuality holds of a browser, a context or a page: unopened until it opens or adopts one, open where it opened it,
 * adopted where it took over the one a connected browser's owner holds, and closed once it closes or the browser
 * disconnects. A closed one opens or is adopted again under the same name, as a tab's next page is. Actuality closes,
 * traces, binds errors to and handles dialogs on only what it opened.
 */

export const HOLDING_STATUS = { UNOPENED: "unopened", OPEN: "open", ADOPTED: "adopted", CLOSED: "closed" } as const;
export type THoldingStatus = (typeof HOLDING_STATUS)[keyof typeof HOLDING_STATUS];

/** What moves a holding: actuality opened it, adopted it, or it closed. */
export const HOLDING_EVENT = { OPENED: "opened", ADOPTED: "adopted", CLOSED: "closed" } as const;
export type THoldingEvent = { type: (typeof HOLDING_EVENT)[keyof typeof HOLDING_EVENT] };

/** A holding's status before it opens. */
export const INITIAL_HOLDING: THoldingStatus = HOLDING_STATUS.UNOPENED;

/** Returns the next status from `status` and `event`. An open or adopted holding stays as it was taken until it closes. */
export function holdingTransition(status: THoldingStatus, { type }: THoldingEvent): THoldingStatus {
	if (type === HOLDING_EVENT.CLOSED) return status === HOLDING_STATUS.UNOPENED ? status : HOLDING_STATUS.CLOSED;
	if (status === HOLDING_STATUS.OPEN || status === HOLDING_STATUS.ADOPTED) return status;
	return type === HOLDING_EVENT.OPENED ? HOLDING_STATUS.OPEN : HOLDING_STATUS.ADOPTED;
}
