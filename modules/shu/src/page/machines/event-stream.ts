/**
 * The page's event stream: unconnected until it first opens, open while actuality's events reach the page, reconnecting
 * after a break until it opens again, and closed once the page closes it. A view reads the status, so a view that follows
 * actuality states whether what it shows is current.
 */

export const STREAM_STATUS = { UNCONNECTED: "unconnected", OPEN: "open", RECONNECTING: "reconnecting", CLOSED: "closed" } as const;
export type TStreamStatus = (typeof STREAM_STATUS)[keyof typeof STREAM_STATUS];

/** What moves the stream: it opened (first or again), it broke, or the page closed it. */
export const STREAM_EVENT = { OPENED: "opened", BROKE: "broke", CLOSE: "close" } as const;
export type TStreamEvent = { type: (typeof STREAM_EVENT)[keyof typeof STREAM_EVENT] };

/** The stream's status before it connects. */
export const INITIAL_STREAM_STATUS: TStreamStatus = STREAM_STATUS.UNCONNECTED;

/** Returns the next status from `status` and `event`. A closed stream stays closed. */
export function streamTransition(status: TStreamStatus, { type }: TStreamEvent): TStreamStatus {
	if (status === STREAM_STATUS.CLOSED) return status;
	if (type === STREAM_EVENT.CLOSE) return STREAM_STATUS.CLOSED;
	if (type === STREAM_EVENT.OPENED) return STREAM_STATUS.OPEN;
	return status === STREAM_STATUS.OPEN ? STREAM_STATUS.RECONNECTING : status;
}
