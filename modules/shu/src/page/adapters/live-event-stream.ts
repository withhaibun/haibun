/**
 * Actuality's event stream over an `SseSubscriber` connection. The subscriber is made at the first call and opened by
 * `connect`. A subscriber added after `connect` receives the events the replay buffer holds, then each new event. The
 * adapter reports each opening, break and close of the connection.
 */
import { SseSubscriber } from "@haibun/core/lib/sse-subscriber.js";
import type { TActualityId } from "@haibun/core/lib/rpc-wire.js";
import type { TEventFilter, TEvent, TEventStream, TStreamReports } from "../ports.js";

/** What the connection reads: the stream's address, the actuality it follows, the headers of its request, and the delay
 *  before it opens again after a break, where the deployment states one. */
export type TLiveStreamSource = { url: string; actualityId: TActualityId; headers: (url: string) => Promise<Record<string, string>>; reconnectDelayMs: number | undefined };

export function liveEventStream(source: () => TLiveStreamSource, reports: TStreamReports): TEventStream {
	let subscriber: SseSubscriber | undefined;
	const ensure = (): SseSubscriber => {
		if (subscriber) return subscriber;
		const { url, actualityId, headers, reconnectDelayMs } = source();
		const made = new SseSubscriber({ url, actualityId, headers, ...(reconnectDelayMs === undefined ? {} : { reconnectDelayMs }) });
		made.opened(() => reports.opened());
		made.disconnected(() => reports.broke());
		subscriber = made;
		return made;
	};
	return {
		subscribe: (handler: (event: TEvent) => void, filter?: TEventFilter) => ensure().subscribe(handler, filter),
		connect: () => ensure().connect(),
		opened: (fn) => ensure().opened(fn),
		reconnected: (fn) => ensure().reconnected(fn),
		disconnected: (fn) => ensure().disconnected(fn),
		totalRecorded: () => (subscriber ? subscriber.totalRecorded() : 0),
		close: () => {
			subscriber?.close();
			subscriber = undefined;
			reports.closed();
		},
	};
}
