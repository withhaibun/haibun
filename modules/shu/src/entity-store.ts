import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { extractQuadsFromEvents } from "@haibun/core/lib/quad-types.js";
import { BODY_LABEL, LinkRelations } from "@haibun/core/lib/resources.js";
import { subscribeBatchedEvents, hasEventStream } from "./event-stream.js";
import { isOffline } from "./hypermedia.js";
import { callStep } from "./pane-fetch.js";
import { appAccessLevel } from "./util.js";
import { derefStoredEntity } from "./quads-snapshot.js";
import { resolveAnnotationsLive, resolveAnnotationsOffline, type AnnotationView } from "./annotation-resolver.js";

/** The client's copy of one entity — the `getIndividualWithEdges` result, kept current by SSE. */
export type TEntityResult = { vertex: Record<string, unknown>; edges: unknown[]; incomingCount: number };

/** Where a served copy came from: a live fetch, the in-memory session cache, or the persisted browser store (offline). */
export type TProvenance = "live" | "cache" | "offline";
export type TEntityStatus = "loading" | "ready" | "error";

/** The whole client-side view of one individual: its entity, the annotations anchored in it, and how it resolved. One
 *  shape for every consumer — the entity fetch, the offline fallback, and every SSE refresh land here, so a view holds
 *  one handle (EntityController) and renders this, never stitching the entity and its annotations from two paths. */
export type TEntityView = {
	status: TEntityStatus;
	provenance?: TProvenance;
	entity?: TEntityResult;
	annotations: AnnotationView[];
	error?: string;
	/** The text of the bodies that have been ASKED for, by body id. A record names the bodies it links (id + media type)
	 *  but never carries their text — a body is a whole document and travels only when a reader opens it. Absent here
	 *  means "not asked for yet", which is why a body area shows as loading rather than empty. */
	bodies: Record<string, string>;
};

/** `annotationSeq` increments per annotation resolve started for this entry, so only the newest resolve writes its result. */
type Entry = { label: string; id: string; view: TEntityView; annotationSeq: number };
type EntityListener = (subject: string) => void;

type Store = {
	entries: Map<string, Entry>;
	listeners: Set<EntityListener>;
	/** The live-quad subscription, installed lazily on first opened entity; null until then / in a static context. */
	unsubscribe: (() => void) | null;
};

// One instance across the separately-built bundles — see quads-snapshot for the rationale.
const STORE_KEY = "__SHU_ENTITY_STORE__";

function getStore(): Store {
	const g = globalThis as unknown as Record<string, Store | undefined>;
	const existing = g[STORE_KEY];
	if (existing) return existing;
	const fresh: Store = { entries: new Map(), listeners: new Set(), unsubscribe: null };
	g[STORE_KEY] = fresh;
	return fresh;
}

// NUL can't occur in a label or id, so it never collides two keys (a label may contain a space; a separator that can
// occur in either part would key `label "A B" + id "C"` and `label "A" + id "B C"` the same).
const keyOf = (label: string, id: string): string => `${label}\0${id}`;

/** A fresh loading view. A new object per call, so no consumer shares (or can mutate) another's. */
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
		try {
			fn(subject);
		} catch {
			// one listener failing must not stop the rest
		}
	}
}

/** Apply observed quads: a scalar change updates the cached copy in place (e.g. a rescheduled time — no refetch); an
 *  `oa:hasSource` anchor landing on a held individual re-resolves that individual's annotations (a note written here or
 *  anywhere). Edge (structure) quads are left to a full reopen. */
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
	s.unsubscribe = subscribeBatchedEvents({ onBatch: (events) => onQuads(extractQuadsFromEvents(events as Record<string, unknown>[])) });
}

/** Resolve the annotations for a held individual by the path its entity took: a copy served from the persisted browser
 *  store walks that same snapshot, a live copy resolves live. A live resolve that cannot reach the server keeps the
 *  annotations already held — the snapshot is not the live graph, so answering from it would report a transient failure
 *  as "no annotations". Only the newest resolve for an entry writes, so a slower earlier one cannot land a stale set
 *  over it (an authored note re-resolves while the open's own resolve may still be in flight). */
async function loadAnnotationsInto(entry: Entry): Promise<void> {
	const seq = ++entry.annotationSeq;
	const annotations = entry.view.provenance === "offline" ? await resolveAnnotationsOffline(entry.id) : await resolveAnnotationsLive(entry.label, entry.id);
	if (annotations === null || seq !== entry.annotationSeq) return;
	entry.view = { ...entry.view, annotations };
}

/** Resolve an individual and the annotations anchored in it into the shared view, notifying subscribers at each step.
 *  Cache-first for the entity (served at once, marked `cache`); on a miss, a live fetch (`live`), then the persisted
 *  browser store (`offline`) when the fetch cannot reach the server. Annotations follow the entity's path: if the entity
 *  fetch reached the server, so will theirs, so one resolution decides both. */
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
		const res = await callStep<TEntityResult>("getIndividualWithEdges", { label, id, accessLevel }, `entity-store: open ${label}:${id}`);
		if (res.ok) {
			entry.view = { status: "ready", provenance: "live", entity: res.value, annotations: [], bodies: {} };
		} else {
			// A live server that answered with an error is a real error — surface it (never mask it as "offline"). Only when
			// there is genuinely no live server (the serialized / file:// report) do we serve the persisted vertex instead.
			const offline = isOffline() ? await derefStoredEntity(label, id) : undefined;
			entry.view = offline
				? { status: "ready", provenance: "offline", entity: offline, annotations: [], bodies: {} }
				: { status: "error", annotations: [], error: res.error, bodies: {} };
			if (!offline) return void notify(s, id);
		}
		notify(s, id);
	}
	await loadAnnotationsInto(entry);
	notify(s, id);
}

/** Read one body's text into a held individual's view — the intentional call a reader's open of that body makes. A
 *  record names its bodies but never carries their text, so nothing streams a document until this asks for it. Already
 *  read (or not a held individual) is a no-op, so re-rendering never refetches. */
export async function requestBody(label: string, id: string, bodyId: string): Promise<void> {
	const s = getStore();
	const entry = s.entries.get(keyOf(label, id));
	if (!entry?.view.entity || entry.view.bodies[bodyId] !== undefined) return;
	const res = await callStep<{ vertex?: { content?: string } }>(
		"getIndividualWithEdges",
		{ label: BODY_LABEL, id: bodyId, accessLevel: appAccessLevel() },
		`entity-store: body ${bodyId}`,
	);
	const content = res.ok ? res.value.vertex?.content : undefined;
	if (typeof content !== "string") return;
	entry.view = { ...entry.view, bodies: { ...entry.view.bodies, [bodyId]: content } };
	notify(s, id);
}

/** The passage a note is anchored to, and the note: what a reader selected and wrote. */
export type TAnnotationDraft = { exact: string; prefix?: string; suffix?: string; text: string };

/** Write a note anchored to a passage of a held individual, then re-resolve so it reads back anchored. Returns the
 *  failure so the caller can drop its optimistic placeholder and say why. */
export async function annotateIndividual(label: string, id: string, draft: TAnnotationDraft): Promise<{ ok: true } | { ok: false; error: string }> {
	const res = await callStep("annotate", { label, id, ...draft }, `entity-store: annotate ${label}:${id}`);
	if (!res.ok) return { ok: false, error: res.error };
	await refreshAnnotations(label, id);
	return { ok: true };
}

/** Re-resolve just a held individual's annotations (a note was authored here) and notify — leaves the entity untouched. */
export async function refreshAnnotations(label: string, id: string): Promise<void> {
	const s = getStore();
	const entry = s.entries.get(keyOf(label, id));
	if (!entry?.view.entity) return;
	await loadAnnotationsInto(entry);
	notify(s, id);
}

/** The whole current view of an individual (status/provenance/entity/annotations) — a loading stub until first opened. */
export function getEntityView(label: string, id: string): TEntityView {
	return getStore().entries.get(keyOf(label, id))?.view ?? loadingView();
}

/** Subscribe to entity changes (a resolve landed, SSE updated a copy, or an annotation re-resolved), by subject id. */
export function subscribeEntities(listener: EntityListener): () => void {
	const s = getStore();
	s.listeners.add(listener);
	return () => s.listeners.delete(listener);
}

/** Test-only teardown. */
export function resetEntityStore(): void {
	const s = getStore();
	s.unsubscribe?.();
	s.entries.clear();
	s.listeners.clear();
	s.unsubscribe = null;
}
