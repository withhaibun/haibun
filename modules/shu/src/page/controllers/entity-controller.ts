import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { TCallLink } from "@haibun/core/lib/domains/hypermedia.js";
import { extractQuadsFromEvents } from "@haibun/core/lib/steps/derivations/quad-events.js";
import * as OpenRecord from "../pipelines/open-record.js";
import type { TWritten } from "../pipelines/call-step.js";
import { unreadView, type TAnnotationDraft, type TEntityView } from "../domains/entity.js";
import { LOAD_STATUS } from "../domains/load.js";
import { hasEventStream, pageRecords } from "../root.js";
import { callStep, followCall, recordRead, recordReadAt } from "./read-controller.js";
import { subscribeBatchedEvents } from "./event-stream-controller.js";
import { isOffline } from "./hydration-controller.js";
import { reportToRun } from "../../client-log.js";
import { cachedGraph } from "../client-cache/controllers/device-controller.js";

/** What an open of a record reads: the page's records, its reads and calls, its stream of observed quads, and its report. */
const scope = (): OpenRecord.TOpenScope => ({
	store: pageRecords(),
	offline: isOffline(),
	subscribe: hasEventStream() ? (onQuads) => subscribeBatchedEvents({ onBatch: (events) => onQuads(extractQuadsFromEvents(events)) }) : undefined,
	readAt: recordReadAt,
	read: recordRead,
	annotations: { call: callStep, quads: (pattern) => cachedGraph().query(pattern) },
	report: (message) => reportToRun("warn", "open-record", message),
});

/** Opens a record and its notes, and resolves once both are read. */
export const openRecord = (label: string, id: string, accessLevel: string): Promise<void> => OpenRecord.openRecord(scope(), label, id, accessLevel);

/** Reads a held record's notes again. */
export const refreshAnnotations = (label: string, id: string): Promise<void> => OpenRecord.refreshAnnotations(scope(), label, id);

/** Returns a record's view, or a loading view until the record first opens. */
export const recordView = (label: string, id: string): TEntityView => OpenRecord.recordView(pageRecords(), label, id);

/** Adds a listener of changes to the records, by subject id, and returns its removal. */
export const followRecords = (listener: OpenRecord.TRecordListener): (() => void) => OpenRecord.followRecords(pageRecords(), listener);

/**
 * EntityController: a view's handle to one record (`page/pipelines/open-record.ts`): the record, the notes anchored in it,
 * and how the page read it. A view holds one and calls `open(label, id, accessLevel)`. The page reads each record once and
 * keeps it current, for every view of it, so the controller passes the record's view to its host on the open, on an
 * observed change, and on a new note, by one path.
 */
export class EntityController implements ReactiveController {
	view: TEntityView;
	private readonly host: ReactiveControllerHost;
	private readonly onChange: (view: TEntityView) => void;
	private label = "";
	private id = "";
	private unsubscribe: (() => void) | null = null;

	constructor(host: ReactiveControllerHost, onChange: (view: TEntityView) => void) {
		this.host = host;
		this.onChange = onChange;
		this.view = unreadView(LOAD_STATUS.PENDING);
		host.addController(this);
	}

	hostConnected(): void {
		this.unsubscribe = followRecords((subject) => {
			if (subject === this.id) this.sync();
		});
	}

	hostDisconnected(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	/** Opens a record: shows the copy the page holds at once, then reads the record and its notes. Resolves once both are
	 *  read, so a caller can await the whole view. */
	async open(label: string, id: string, accessLevel: string): Promise<void> {
		this.label = label;
		this.id = id;
		this.sync();
		await openRecord(label, id, accessLevel);
		if (this.id === id) this.sync();
	}

	/** Reads the open record's notes again, after a note is written here, before the stream reports it. */
	refreshAnnotations(): void {
		if (this.id) void refreshAnnotations(this.label, this.id);
	}

	/** Reads one of the open record's bodies whole into `view.bodies`, by its id. The open names the bodies, and a body's text
	 *  is read only here. */
	requestBody(bodyId: string): void {
		if (this.id && bodyId) void OpenRecord.requestBody(scope(), this.label, this.id, bodyId);
	}

	/** Writes a note anchored in a passage of the open record, then reads its notes again so the note shows anchored. */
	annotate(draft: TAnnotationDraft): Promise<TWritten> {
		if (!this.id) return Promise.resolve({ ok: false as const, refusal: { error: "a record isn't open to annotate" } });
		return OpenRecord.annotateRecord(scope(), this.label, this.id, draft);
	}

	/** Follows a call the open record links, and returns what the call returned. */
	follow<T>(link: TCallLink): Promise<T> {
		return followCall<T>(link, `${this.label} ${this.id}: ${link.summary ?? link.method}`);
	}

	/** Stops following the open record. A host that shows a step's products in place of a record then keeps them, where a
	 *  change to the record it last opened would otherwise replace them. */
	release(): void {
		this.label = "";
		this.id = "";
		this.view = unreadView(LOAD_STATUS.PENDING);
	}

	private sync(): void {
		this.view = recordView(this.label, this.id);
		this.onChange(this.view);
		this.host.requestUpdate();
	}
}
