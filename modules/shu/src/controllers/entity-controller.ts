import type { ReactiveController, ReactiveControllerHost } from "lit";
import { openEntity, refreshAnnotations, requestBody, annotateIndividual, getEntityView, subscribeEntities, type TEntityView, type TAnnotationDraft } from "../entity-store.js";

/**
 * EntityController — the per-view handle to ONE individual's data: its entity, the annotations anchored in it, and how
 * it resolved (live fetch / session cache / persisted browser store when offline). A view HOLDS one and calls
 * `open(label, id, accessLevel)`; it never calls the fetch / offline / annotation primitives itself.
 *
 * Resolution and freshness live once, in the shared entity-store: one cache and one SSE subscription for every view of
 * the same individual. The controller relays the store's `TEntityView` to the host — the initial resolve, a live field
 * update over SSE, and a newly-anchored annotation all arrive by the same path, so the entity and its annotations are
 * never stitched from two uncoordinated fetches. See ./index.ts for the pattern; data-access.test.ts enforces it.
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
		this.view = getEntityView("", "");
		host.addController(this);
	}

	hostConnected(): void {
		this.unsubscribe = subscribeEntities((subject) => {
			if (subject === this.id) this.sync();
		});
	}

	hostDisconnected(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	/** Open an individual: apply any cached view at once, then resolve (fetch → offline) it and its annotations. Resolves
	 *  when the individual has settled, so a caller can `await` a fully-applied view (a cache hit settles synchronously). */
	async open(label: string, id: string, accessLevel: string): Promise<void> {
		this.label = label;
		this.id = id;
		this.sync();
		await openEntity(label, id, accessLevel);
		if (this.id === id) this.sync();
	}

	/** Re-resolve just this individual's annotations (a note was authored here), ahead of the SSE round-trip. */
	refreshAnnotations(): void {
		if (this.id) void refreshAnnotations(this.label, this.id);
	}

	/** Read one of this individual's bodies — the intentional call that fetches a document's text. The view names its
	 *  bodies from the open; their text arrives only through this, and lands in `view.bodies` by id. */
	requestBody(bodyId: string): void {
		if (this.id && bodyId) void requestBody(this.label, this.id, bodyId);
	}

	/** Write a note anchored to a passage of this individual, and re-resolve so it reads back anchored. */
	annotate(draft: TAnnotationDraft): Promise<{ ok: true } | { ok: false; error: string }> {
		if (!this.id) return Promise.resolve({ ok: false as const, error: "no individual open to annotate" });
		return annotateIndividual(this.label, this.id, draft);
	}

	/** Stop tracking the opened individual. A host that shows something else (arbitrary products rather than a resolved
	 *  individual) takes no further updates for it — otherwise a live change to the individual it last opened would
	 *  replace what the host is showing. */
	release(): void {
		this.label = "";
		this.id = "";
		this.view = getEntityView("", "");
	}

	private sync(): void {
		this.view = getEntityView(this.label, this.id);
		this.onChange(this.view);
		this.host.requestUpdate();
	}
}
