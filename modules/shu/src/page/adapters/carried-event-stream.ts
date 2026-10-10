/**
 * The events a page carries in a record of actuality, and the events a test supplies. The stream holds every event it is
 * given, and is open from its start, since it holds the whole record. A subscriber receives every event emitted so far,
 * then each new one. A test drives a scripted scenario: `emit` adds an event, `disconnect` reports a break, and
 * `reconnect` reports the stream open again.
 */
import { StreamListeners } from "@haibun/core/lib/sse-subscriber.js";
import type { TEventFilter, TEvent, TEventStream, TStreamReports } from "../ports.js";

export class CarriedEventStream implements TEventStream {
	private readonly followers = new StreamListeners<TEvent>("CarriedEventStream", Number.POSITIVE_INFINITY, true);

	constructor(private readonly reports: TStreamReports) {
		reports.opened();
	}

	subscribe(handler: (event: TEvent) => void, filter?: TEventFilter): () => void {
		return this.followers.subscribe(handler, filter);
	}

	connect(): void {
		// The record is open from the stream's start, so `connect` doesn't change it.
	}

	opened(fn: () => void): () => void {
		return this.followers.opened(fn);
	}

	reconnected(fn: () => void): () => void {
		return this.followers.reconnected(fn);
	}

	disconnected(fn: () => void): () => void {
		return this.followers.disconnected(fn);
	}

	/** Reports a break, as a scripted scenario drives one. A carried record doesn't break. */
	disconnect(): void {
		this.followers.broke();
		this.reports.broke();
	}

	/** Reports the stream open again after a break, as a scripted scenario drives one. */
	reconnect(): void {
		this.followers.becameOpen();
		this.reports.opened();
	}

	/** Adds an event to the record and sends it to each subscriber `filter` selects. */
	emit(event: TEvent): void {
		this.followers.dispatch(event);
	}

	totalRecorded(): number {
		return this.followers.totalRecorded();
	}

	close(): void {
		this.followers.clear();
		this.reports.closed();
	}
}
