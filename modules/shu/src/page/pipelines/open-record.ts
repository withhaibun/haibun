/**
 * The records the page shows (`page/domains/entity.ts`), each read once and kept current: a record opens from the copy the
 * page holds, or reads through the site, and its notes read by the same provenance. An observed quad updates a field of a
 * held record in place, an observed edge of a held record reads the record again, and a note anchored in a held record from
 * any page reads its notes again.
 */
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import { BODY_LABEL, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { LinkedBodySchema } from "@haibun/core/lib/records/domains/body.js";
import type { TIndividualWithEdges, TQuad } from "@haibun/core/lib/quad-types.js";
import { unreadView, type TAnnotationDraft, type TEntityView } from "../domains/entity.js";
import { LOAD_STATUS } from "../domains/load.js";
import { annotationsHeld, annotationsOnSite, type TAnnotationScope } from "./annotations.js";
import type { TCallOutcome, TWritten } from "./call-step.js";

/** A held record: its view, the level it was read at, the newest read of the record, and a count of the reads of its notes
 *  started. Only the newest read of each writes its result. */
type TEntry = { label: string; id: string; accessLevel: string; view: TEntityView; reading: Promise<void>; annotationSeq: number };
export type TRecordListener = (subject: string) => void;

/** The records the page holds, the views that follow them, and the subscription to observed quads, which the first open
 *  installs where the page has an event stream. */
export type TRecordStore = { entries: Map<string, TEntry>; listeners: Set<TRecordListener>; unsubscribe: (() => void) | undefined };

/** What an open reads: the store, whether the page carries a record of actuality, the subscription to observed quads where
 *  the page has an event stream, the reads of a record and of a body, a call, the reads of notes, and a diagnostic report. */
export type TOpenScope = {
	store: TRecordStore;
	offline: boolean;
	subscribe: ((onQuads: (quads: TQuad[]) => void) => () => void) | undefined;
	readAt: (label: string, id: string, accessLevel: string) => Promise<TCallOutcome<TIndividualWithEdges>>;
	read: (label: string, id: string) => Promise<TCallOutcome<TIndividualWithEdges>>;
	annotations: TAnnotationScope;
	report: (message: string) => void;
};

// NUL can't occur in a label or an id, so two pairs never share a key. A label may contain a space, so a separator that a
// part can hold would give `label "A B" + id "C"` and `label "A" + id "B C"` one key.
const keyOf = (label: string, id: string): string => `${label}\0${id}`;

/** Returns the entry of a record the page opens at `accessLevel`. A later read of the record reads at that level. */
function entryOf(store: TRecordStore, label: string, id: string, accessLevel: string): TEntry {
	const key = keyOf(label, id);
	const held = store.entries.get(key);
	if (held !== undefined) {
		held.accessLevel = accessLevel;
		return held;
	}
	const entry = { label, id, accessLevel, view: unreadView(LOAD_STATUS.PENDING), reading: Promise.resolve(), annotationSeq: 0 };
	store.entries.set(key, entry);
	return entry;
}

/** Calls each listener with `subject`, which changed. A failing listener is reported, and the rest still run. */
function notify(scope: TOpenScope, subject: string): void {
	for (const listener of scope.store.listeners) {
		try {
			listener(subject);
		} catch (err) {
			scope.report(`a listener of ${subject} failed: ${errorDetail(err)}`);
		}
	}
}

/** Applies observed quads. A field quad updates the held copy in place, without a read. An edge quad of a record the page
 *  holds or reads changes what the record links, as its bodies, so the record is read again: a read that started before the
 *  edge was written doesn't hold it. An `oa:hasSource` quad whose object is a held record reads that record's notes again. */
function onQuads(scope: TOpenScope, quads: TQuad[]): void {
	const touched = new Set<string>();
	const restructured = new Set<TEntry>();
	const reanchored = new Set<string>();
	for (const q of quads) {
		if (q.predicate === LinkRelations.HAS_SOURCE.rel && typeof q.object === "string") {
			reanchored.add(q.object);
			continue;
		}
		const entry = scope.store.entries.get(keyOf(q.namedGraph, q.subject));
		if (q.objectType) {
			if (entry) restructured.add(entry);
			continue;
		}
		if (entry?.view.entity === undefined) continue;
		entry.view.entity.vertex[q.predicate] = q.object;
		touched.add(q.subject);
	}
	for (const subject of touched) notify(scope, subject);
	for (const entry of restructured) void readRecordInto(scope, entry);
	for (const entry of scope.store.entries.values()) if (reanchored.has(entry.id)) void refreshAnnotations(scope, entry.label, entry.id);
}

/**
 * Reads a record at the level it was opened at, keeps its notes and the bodies the reader read, and calls the listeners. A
 * refused read of a record the page holds keeps the held record and is reported, and a refused first read holds the refusal.
 * Only the newest read writes, so a read that started before an edge was written can't replace a read that holds it. A
 * superseded read resolves with the newest, so a caller awaits the record as the newest read returns it.
 */
function readRecordInto(scope: TOpenScope, entry: TEntry): Promise<void> {
	const reading: Promise<void> = scope.readAt(entry.label, entry.id, entry.accessLevel).then((read) => {
		if (entry.reading !== reading) return entry.reading;
		if (!read.ok && entry.view.entity) return scope.report(`${entry.label}:${entry.id} wasn't read again: ${read.refusal.error}`);
		entry.view = read.ok
			? { ...entry.view, status: LOAD_STATUS.COMPLETED, provenance: scope.offline ? "offline" : "live", entity: read.value }
			: { status: LOAD_STATUS.FAILED, annotations: [], refusal: read.refusal, bodies: {} };
		notify(scope, entry.id);
	});
	entry.reading = reading;
	return reading;
}

function followQuads(scope: TOpenScope): void {
	if (scope.store.unsubscribe !== undefined || scope.subscribe === undefined) return;
	scope.store.unsubscribe = scope.subscribe((quads) => onQuads(scope, quads));
}

/** Reads a held record's notes by its provenance: an `offline` record's from the quads the page holds, and any other's
 *  through the site. A refused read keeps the notes the page holds and is reported; the quads the page holds aren't the
 *  site's graph, so a read of them would show a failure as an empty set of notes. Only the newest read writes, so a slower
 *  earlier read can't replace a newer result. */
async function readAnnotationsInto(scope: TOpenScope, entry: TEntry): Promise<void> {
	const seq = ++entry.annotationSeq;
	if (entry.view.provenance === "offline") {
		const held = await annotationsHeld(scope.annotations, entry.id);
		if (seq === entry.annotationSeq) entry.view = { ...entry.view, annotations: held };
		return;
	}
	const read = await annotationsOnSite(scope.annotations, entry.label, entry.id);
	if (!read.ok) return scope.report(`the notes of ${entry.label}:${entry.id} weren't read: ${read.refusal.error}`);
	if (seq === entry.annotationSeq) entry.view = { ...entry.view, annotations: read.value };
}

/** Opens a record and its notes, and calls the listeners at each step. A held record opens at once as `cache`. Another
 *  record reads through `readAt`, as `offline` where the page carries a record of actuality and `live` otherwise; a refused
 *  read holds the refusal. */
export async function openRecord(scope: TOpenScope, label: string, id: string, accessLevel: string): Promise<void> {
	followQuads(scope);
	const entry = entryOf(scope.store, label, id, accessLevel);
	if (entry.view.entity !== undefined) {
		entry.view = { ...entry.view, status: LOAD_STATUS.COMPLETED, provenance: "cache" };
		notify(scope, id);
	} else {
		entry.view = unreadView(LOAD_STATUS.RUNNING);
		notify(scope, id);
		await readRecordInto(scope, entry);
		if (entry.view.entity === undefined) return;
	}
	await readAnnotationsInto(scope, entry);
	notify(scope, id);
}

/** Reads one body whole, with the text of each of its forms, into a held record's view, when a reader opens it. A body
 *  already read, or a record the page doesn't hold, returns at once, so a render doesn't read again. A body that isn't read
 *  is reported and its area stays loading. */
export async function requestBody(scope: TOpenScope, label: string, id: string, bodyId: string): Promise<void> {
	const entry = scope.store.entries.get(keyOf(label, id));
	if (entry?.view.entity === undefined || entry.view.bodies[bodyId] !== undefined) return;
	const read = await scope.read(BODY_LABEL, bodyId);
	if (!read.ok) return scope.report(`the body ${bodyId} of ${label}:${id} wasn't read: ${read.refusal.error}`);
	entry.view = { ...entry.view, bodies: { ...entry.view.bodies, [bodyId]: LinkedBodySchema.parse({ ...read.value.vertex, id: bodyId }) } };
	notify(scope, id);
}

/** Writes a note anchored in a passage of a held record through the annotate step, then reads the record's notes again so
 *  the note reads back anchored. Returns the refusal, so the caller can remove its placeholder and show the cause. */
export async function annotateRecord(scope: TOpenScope, label: string, id: string, draft: TAnnotationDraft): Promise<TWritten> {
	const written = await scope.annotations.call("annotate", { label, id, ...draft }, `a note on ${label}:${id}`);
	if (!written.ok) return written;
	await refreshAnnotations(scope, label, id);
	return { ok: true };
}

/** Reads a held record's notes again, and calls the listeners, without changing the record. */
export async function refreshAnnotations(scope: TOpenScope, label: string, id: string): Promise<void> {
	const entry = scope.store.entries.get(keyOf(label, id));
	if (entry?.view.entity === undefined) return;
	await readAnnotationsInto(scope, entry);
	notify(scope, id);
}

/** Returns a record's view, or a pending view until the record first opens. */
export const recordView = (store: TRecordStore, label: string, id: string): TEntityView => store.entries.get(keyOf(label, id))?.view ?? unreadView(LOAD_STATUS.PENDING);

/** Adds a listener of changes to the records, by subject id, and returns its removal. */
export function followRecords(store: TRecordStore, listener: TRecordListener): () => void {
	store.listeners.add(listener);
	return () => store.listeners.delete(listener);
}
