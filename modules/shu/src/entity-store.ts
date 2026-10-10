import { isOffline } from "./rpc-registry.js";
import type { TCounted } from "@haibun/core/lib/hypermedia.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { extractQuadsFromEvents } from "@haibun/core/lib/quad-types.js";
import { BODY_LABEL, LinkRelations } from "@haibun/core/lib/resources.js";
import { subscribeBatchedEvents, hasEventStream } from "./page/controllers/event-stream-controller.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { reportToRun } from "./client-log.js";
import { callStep } from "./pane-fetch.js";
import { pagePinned } from "./page/adapters/page-held.js";
import { appAccessLevel } from "./util.js";
import { readIndividual } from "./quads-snapshot.js";
import { resolveAnnotationsLive, resolveAnnotationsOffline, type AnnotationView } from "./annotation-resolver.js";

/** The client's copy of one entity. It holds the `getIndividualWithEdges` result. SSE quads keep its scalar fields current. */
export type TEntityResult = { vertex: Record<string, unknown>; edges: unknown[]; incomingCount: TCounted };

/** The source of a served copy. `live` is a read through `readIndividual` on a served page. `cache` is the copy
 *  this session already holds. `offline` is a read from the store of a page that carries its own actuality record. */
type TProvenance = "live" | "cache" | "offline";
type TEntityStatus = "loading" | "ready" | "error";

/** The client-side view of one individual. It holds the entity, the annotations anchored in it, the read bodies and the
 *  resolution status. Each entity read, annotation resolve, body read and SSE refresh writes this one shape. A view holds
 *  one handle (EntityController) and renders this shape. The view doesn't combine the entity and its annotations from two
 *  paths. */
export type TEntityView = {
	status: TEntityStatus;
	provenance?: TProvenance;
	entity?: TEntityResult;
	annotations: AnnotationView[];
	error?: string;
	/** Maps each read body's id to the body's text. A record names the bodies it links by id and media type. It doesn't
	 *  carry their text, because a body is a whole document. `requestBody` reads a body's text when a reader opens the body.
	 *  A body id absent here hasn't been read, so its body area renders as loading rather than empty. */
	bodies: Record<string, string>;
};

/** `annotationSeq` increments per annotation resolve started for this entry, so only the newest resolve writes its result. */
type Entry = { label: string; id: string; view: TEntityView; annotationSeq: number };
type EntityListener = (subject: string) => void;

type Store = {
	entries: Map<string, Entry>;
	listeners: Set<EntityListener>;
	/** The live-quad subscription. `ensureFreshness` installs it when the first entity opens. It holds null before then and in a static context. */
	unsubscribe: (() => void) | null;
};

// `pagePinned` holds one store under this key for every separately built bundle. The comment on quads-snapshot.ts's
// STORE_KEY states the rationale.
const STORE_KEY = "__SHU_ENTITY_STORE__";

function getStore(): Store {
	return pagePinned(
		STORE_KEY,
		(): Store => ({ entries: new Map(), listeners: new Set(), unsubscribe: null }),
		(store) => store.unsubscribe?.(),
	);
}

// NUL can't occur in a label or an id, so two different pairs never share a key. A label may contain a space. A separator
// that can occur in either part would give `label "A B" + id "C"` and `label "A" + id "B C"` the same key.
const keyOf = (label: string, id: string): string => `${label}\0${id}`;

/** Returns a new loading view per call, so one consumer can't mutate another consumer's view. */
const loadingView = (): TEntityView => ({ status: "loading", annotations: [], bodies: {} });

function entryOf(s: Store, label: string, id: string): Entry {
	const key = keyOf(label, id);
	let entry = s.entries.get(key);
	if (!entry) {
		entry = { label, id, view: loadingView(), annotationSeq: 0 };
		s.entries.set(key, entry);
	}
	return entry;
}

function notify(s: Store, subject: string): void {
	for (const fn of s.listeners) {
		// Reports a failing listener to actuality. The remaining listeners still run.
		try {
			fn(subject);
		} catch (err) {
			reportToRun("error", "entity-store", `a listener of ${subject} failed: ${errorDetail(err)}`);
		}
	}
}

/** Applies observed quads. A scalar quad updates the held copy in place without a refetch (a rescheduled time, for
 *  example). An `oa:hasSource` quad whose object is a held individual re-resolves that individual's annotations. The note
 *  may come from this page or any other. An edge quad changes structure, so this function skips it. A full reopen reads the
 *  new structure. */
function onQuads(quads: TQuad[]): void {
	const s = getStore();
	const touched = new Set<string>();
	const reanchored = new Set<string>();
	for (const q of quads) {
		if (q.predicate === LinkRelations.HAS_SOURCE.rel && typeof q.object === "string") {
			reanchored.add(q.object);
			continue;
		}
		if (q.objectType) continue; // an edge quad changes structure, not a scalar field
		const entry = s.entries.get(keyOf(q.namedGraph, q.subject));
		if (!entry?.view.entity) continue;
		entry.view.entity.vertex[q.predicate] = q.object;
		touched.add(q.subject);
	}
	for (const subject of touched) notify(s, subject);
	if (reanchored.size > 0) for (const entry of s.entries.values()) if (reanchored.has(entry.id)) void refreshAnnotations(entry.label, entry.id);
}

function ensureFreshness(s: Store): void {
	if (s.unsubscribe || !hasEventStream()) return;
	s.unsubscribe = subscribeBatchedEvents({ onBatch: (events) => onQuads(extractQuadsFromEvents(events)) });
}

/** Resolves the annotations of a held individual by its entity's provenance. An `offline` entity's annotations resolve
 *  from the held snapshot. Any other entity's annotations resolve live. A failed live resolve keeps the annotations already
 *  held and doesn't walk the snapshot. The snapshot isn't the live graph. A walk of it would show a transient failure as an
 *  empty set of annotations. Only the newest resolve for an entry writes, so a slower earlier resolve can't overwrite the
 *  newest result with a stale set. `annotateIndividual` can start a resolve while the resolve `openEntity` started is still
 *  running. */
async function loadAnnotationsInto(entry: Entry): Promise<void> {
	const seq = ++entry.annotationSeq;
	const annotations = entry.view.provenance === "offline" ? await resolveAnnotationsOffline(entry.id) : await resolveAnnotationsLive(entry.label, entry.id);
	if (annotations === null || seq !== entry.annotationSeq) return;
	entry.view = { ...entry.view, annotations };
}

/** Resolves an individual and the annotations anchored in it into the shared view. Notifies subscribers at each step.
 *  Serves a held entity at once and marks it `cache`. Reads an entity the store doesn't hold through `readIndividual`. Marks
 *  that read `offline` where the page carries its own actuality record (`isOffline`), else `live`. A rejected read sets the
 *  view's status to `error`. The annotations resolve by the entity's provenance, so one provenance selects the path for
 *  both. */
export async function openEntity(label: string, id: string, accessLevel: string): Promise<void> {
	const s = getStore();
	ensureFreshness(s);
	const entry = entryOf(s, label, id);
	if (entry.view.entity) {
		entry.view = { ...entry.view, status: "ready", provenance: "cache" };
		notify(s, id);
	} else {
		entry.view = loadingView();
		notify(s, id);
		// `readIndividual` returns the site's response. It returns the individual as this page holds it where the site doesn't
		// respond or the page reads another actuality's records. A copy the page holds is marked `live` on a served page, so the
		// provenance doesn't separate those sources.
		const read = await readIndividual(label, id, accessLevel).catch((err: unknown) => errorDetail(err));
		if (typeof read === "string") {
			entry.view = { status: "error", annotations: [], error: read, bodies: {} };
			return void notify(s, id);
		}
		entry.view = { status: "ready", provenance: isOffline() ? "offline" : "live", entity: read as TEntityResult, annotations: [], bodies: {} };
		notify(s, id);
	}
	await loadAnnotationsInto(entry);
	notify(s, id);
}

/** Reads one body's text into a held individual's view. A view calls this when a reader opens that body. A record names its
 *  bodies but doesn't carry their text, so a body's text isn't read until this call requests it. The call returns at once
 *  for a body already read or for an individual the store doesn't hold, so a re-render doesn't refetch. */
export async function requestBody(label: string, id: string, bodyId: string): Promise<void> {
	const s = getStore();
	const entry = s.entries.get(keyOf(label, id));
	if (!entry?.view.entity || entry.view.bodies[bodyId] !== undefined) return;
	// A body that can't be read leaves its area loading, so the failure is reported to actuality rather than dropped.
	const read = await readIndividual(BODY_LABEL, bodyId, appAccessLevel()).catch((err: unknown) => {
		reportToRun("warn", "entity-store", `the body ${bodyId} of ${label}:${id} could not be read: ${errorDetail(err)}`);
		return undefined;
	});
	const content = read?.vertex.content;
	if (typeof content !== "string") return;
	entry.view = { ...entry.view, bodies: { ...entry.view.bodies, [bodyId]: content } };
	notify(s, id);
}

/** A note draft. It holds the passage the reader selected (`exact`, `prefix`, `suffix`) and the note's `text`. */
export type TAnnotationDraft = { exact: string; prefix?: string; suffix?: string; text: string };

/** Writes a note anchored to a passage of a held individual through the `annotate` step. It then re-resolves the
 *  individual's annotations so the note reads back anchored. Returns the failure so the caller can remove its optimistic
 *  placeholder and show the reason. */
export async function annotateIndividual(label: string, id: string, draft: TAnnotationDraft): Promise<{ ok: true } | { ok: false; error: string }> {
	const res = await callStep("annotate", { label, id, ...draft }, `entity-store: annotate ${label}:${id}`);
	if (!res.ok) return { ok: false, error: res.error };
	await refreshAnnotations(label, id);
	return { ok: true };
}

/** Re-resolves a held individual's annotations and notifies subscribers without changing the entity. */
export async function refreshAnnotations(label: string, id: string): Promise<void> {
	const s = getStore();
	const entry = s.entries.get(keyOf(label, id));
	if (!entry?.view.entity) return;
	await loadAnnotationsInto(entry);
	notify(s, id);
}

/** Returns the current view of an individual (status, provenance, entity and annotations), or a loading stub until the individual first opens. */
export function getEntityView(label: string, id: string): TEntityView {
	return getStore().entries.get(keyOf(label, id))?.view ?? loadingView();
}

/** Subscribes a listener to entity changes by subject id. A change is a started or completed resolve, a body read, an SSE
 *  update to a copy or an annotation re-resolve. Returns an unsubscribe. */
export function subscribeEntities(listener: EntityListener): () => void {
	const s = getStore();
	s.listeners.add(listener);
	return () => s.listeners.delete(listener);
}
