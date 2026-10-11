/** The strip's pane elements: creates, updates and removes them, and follows the controls each pane carries. */
import type { TPaneControl, TPaneElement, TPaneMarks, TPaneSpec, TPaneStrip, TStripElement } from "../ports.js";

/** Returns the pane strip over `strip`, which makes its elements in `doc` and defines its views through `elements`. */
export function browserPaneStrip(doc: Document, elements: CustomElementRegistry, strip: TStripElement, marks: TPaneMarks): TPaneStrip {
	/** A pane's id: its column key, or for the page's index pane, which the page renders, its column type. */
	const idOf = (pane: TPaneElement): string | null => pane.dataset.columnKey ?? pane.getAttribute(marks.columnType);
	const paneOf = (id: string): TPaneElement | undefined => strip.panes.find((pane) => pane.dataset.columnKey === id);
	const tag = marks.paneTag.toUpperCase();
	/** Returns the pane `source` is in: an element's closest pane, or the first pane on an event's path, its target's or its
	 *  current target's, each of which an event states in a different phase of its dispatch. */
	const sourcePane = (source: Element | Event): Element | null => {
		if (source instanceof Element) return source.closest(marks.paneTag);
		const onPath = source.composedPath().find((el): el is Element => el instanceof Element && el.tagName === tag);
		if (onPath !== undefined) return onPath;
		for (const at of [source.target, source.currentTarget]) {
			const pane = at instanceof Element ? at.closest(marks.paneTag) : null;
			if (pane !== null) return pane;
		}
		return null;
	};
	return {
		ids: () =>
			strip.panes.flatMap((pane) => {
				const id = idOf(pane);
				return id === null ? [] : [id];
			}),
		view: (id) => {
			const view = paneOf(id)?.children[0];
			return view instanceof HTMLElement ? view : undefined;
		},
		remove: (id) => {
			const index = strip.panes.findIndex((pane) => idOf(pane) === id);
			// The strip publishes its panes for each removal it makes, so a reader of the panes sees each one.
			if (index >= 0) strip.removePane(index);
		},
		update: (id, label, minimized, docked) => {
			const pane = strip.panes.find((p) => idOf(p) === id);
			if (pane === undefined) throw new Error(`the strip doesn't hold the pane ${id} it updates`);
			pane.setAttribute("label", label);
			pane.setMinimized(minimized);
			if (pane.docked === docked) return false;
			pane.setDocked(docked);
			return true;
		},
		open: async (spec: TPaneSpec) => {
			// One pane for each id. A request during the view's load can open the same id, and two panes of one id are panes
			// the pipeline can't distinguish.
			if (strip.panes.some((pane) => pane.dataset.columnKey === spec.id)) return undefined;
			const pane = doc.createElement(marks.paneTag) as TPaneElement;
			pane.setAttribute("label", spec.label);
			pane.setAttribute(marks.columnType, spec.columnType);
			// The id is also the pane's stored identity, so its width and minimize return when it attaches.
			pane.dataset.columnKey = spec.id;
			if (!spec.closable) pane.setAttribute(marks.closable, "false");
			// Docked and minimized before it attaches, so the strip doesn't lay it out as a column or activate it.
			if (spec.docked) pane.setDocked(true);
			if (spec.minimized) pane.setMinimized(true);
			strip.addPane(pane);
			const view = doc.createElement(spec.viewTag);
			for (const [name, value] of Object.entries(spec.viewAttributes)) view.setAttribute(name, value);
			spec.seed(view);
			pane.appendChild(view);
			pane.setMinimized(spec.minimized);
			// A view's methods exist once its element upgrades to its definition. The definition arrives on a later task than
			// its load, and the upgrade of an element made before it is a reaction that hasn't always run when the wait resolves.
			await elements.whenDefined(spec.viewTag);
			elements.upgrade(view);
			const definition = elements.get(spec.viewTag);
			if (definition !== undefined && !(view instanceof definition)) throw new Error(`pane ${spec.id}: <${spec.viewTag}> is defined, and its view didn't upgrade to it`);
			return view;
		},
		settle: (maximized, placementChanged) => {
			if (placementChanged) strip.layoutColumns();
			for (const pane of strip.panes) pane.setMaximized(maximized !== null && idOf(pane) === maximized);
			strip.updateAccordion();
			strip.applyActive();
		},
		after: (source) => {
			const pane = sourcePane(source);
			const index = pane === null ? -1 : strip.panes.findIndex((p) => p === pane);
			if (index < 0) return undefined;
			return strip.panes.slice(index + 1).flatMap((p) => (p.hasAttribute(marks.pinned) || p.docked || p.dataset.columnKey === undefined ? [] : [p.dataset.columnKey]));
		},
		close: (id) => {
			const pane = paneOf(id);
			pane?.setPinned(false);
			pane?.close();
		},
		onControl: (handler) => {
			/** Follows the event `name` of a pane's control, as the change `control` reads from its event. */
			const follow = (name: string, control: (e: CustomEvent<Record<string, unknown> | null>) => TPaneControl): void =>
				strip.addEventListener(name, (e: Event) => {
					const id = (e.target as HTMLElement).dataset.columnKey;
					if (id !== undefined) handler(id, control(e as CustomEvent<Record<string, unknown> | null>));
				});
			follow(marks.events.minimize, (e) => ({ flag: e.detail?.minimized === true ? "min" : undefined }));
			follow(marks.events.maximize, (e) => ({ flag: e.detail?.maximized === true ? "max" : undefined }));
			follow(marks.events.dock, (e) => ({ docked: e.detail?.docked === true }));
			follow(marks.events.expand, () => ({ flag: undefined }));
		},
	};
}
