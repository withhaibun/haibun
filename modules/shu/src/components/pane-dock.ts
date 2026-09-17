/**
 * PaneDock stands a pane along the bottom of the app. It sets the pane's open height as a share of the app, or the whole
 * height where the pane is maximized. It drags the top edge, closes the pane to its strip on a click elsewhere, reserves
 * the closed strip's height on the positioning host, and marks an open pane as covering the columns. It states the pane
 * as `dockedPane`, which the page strip reads. A pinned pane stays open. A pane in the strip doesn't use any of this.
 */
import type { ReactiveController } from "lit";
import { DOCK_FOOTPRINT, SHU_ATTR } from "../consts.js";
import { dockedPane } from "../signals.js";
import { draggedHeight, draggedProportion, openAtProportion } from "./dock-model.js";
import { FootprintController } from "./footprint.js";
import { startPointerDrag } from "./pointer-drag.js";
import type { TControllerHost } from "./controller-host.js";

/** What the dock reads from its pane and how it changes it. */
export type TPaneDockDeps = {
	/** The pane's key, stated as the docked pane. */
	key: () => string;
	docked: () => boolean;
	/** Whether the docked pane stands at its strip. */
	closed: () => boolean;
	setClosed: (closed: boolean) => void;
	/** Whether the pane fills the app's height. A maximized column fills the strip's width. */
	maximized: () => boolean;
	pinned: () => boolean;
	/** The remembered open height, as a share of the app. */
	height: () => number | undefined;
	setHeight: (share: number) => void;
};

/** Whether an element with the tag is inside the root, through the shadow roots of what it holds. */
function holdsTag(root: ParentNode, tag: string): boolean {
	for (const element of Array.from(root.querySelectorAll("*"))) {
		if (element.localName === tag) return true;
		if (element.shadowRoot && holdsTag(element.shadowRoot, tag)) return true;
	}
	return false;
}

export class PaneDock implements ReactiveController {
	readonly #host: TControllerHost;
	readonly #deps: TPaneDockDeps;
	/** Reserves the closed strip's height, with the pane's top border, while the pane is docked. */
	readonly #footprint: FootprintController;
	/** The drag in flight. It holds where the drag began, the height and container height it began at, and how to stop it. */
	#drag: { startY: number; startHeight: number; containerHeight: number; framePending: boolean; stop: () => void } | null = null;

	constructor(host: TControllerHost, deps: TPaneDockDeps) {
		this.#host = host;
		this.#deps = deps;
		this.#footprint = new FootprintController(host, DOCK_FOOTPRINT, () => this.#closedHeight());
		host.addController(this);
	}

	hostConnected(): void {
		document.addEventListener("click", this.#onDocumentClick, true);
	}

	/** Stands a docked pane at its open height or at its strip, before each render. */
	hostUpdate(): void {
		this.#apply();
	}

	hostUpdated(): void {
		this.#stateDocked();
	}

	hostDisconnected(): void {
		document.removeEventListener("click", this.#onDocumentClick, true);
		this.#drag?.stop();
		this.#drag = null;
		if (dockedPane.get()?.key === this.#deps.key()) dockedPane.set(null);
	}

	/** Start a drag of the top edge. A docked pane grows up from the bottom, so dragging the edge up makes it taller. */
	onResizeDown = (e: PointerEvent): void => {
		e.preventDefault();
		e.stopPropagation();
		this.#drag?.stop();
		const stop = startPointerDrag(e, { onMove: (move) => this.#onResizeMove(move.clientY), onEnd: () => this.#onResizeEnd() });
		this.#drag = { startY: e.clientY, startHeight: this.#host.offsetHeight, containerHeight: this.#containerHeight(), framePending: false, stop };
	};

	/** Stand at the open height or the strip, and mark whether the pane covers the columns. */
	#apply(): void {
		const open = this.#deps.docked() && !this.#deps.closed();
		const share = this.#deps.maximized() ? 1 : openAtProportion(this.#deps.height());
		this.#host.style.height = open ? `${(share * 100).toFixed(2)}%` : "";
		this.#host.toggleAttribute(SHU_ATTR.DATA_COVERS_VIEWS, open);
	}

	/** Measures the closed strip's height while the pane is docked, and returns null where the pane stands in the strip. A
	 *  closed pane is its strip. An open pane's strip is its header, plus the pane's top border. */
	#closedHeight(): number | null {
		if (!this.#deps.docked()) return null;
		if (this.#deps.closed()) return this.#host.offsetHeight;
		const header = this.#host.renderRoot.querySelector<HTMLElement>(".pane-header");
		if (!header) return null;
		return header.offsetHeight + (Number.parseFloat(getComputedStyle(this.#host).borderTopWidth) || 0);
	}

	/** States this pane as the docked pane. It clears that statement where this pane no longer docks. */
	#stateDocked(): void {
		const key = this.#deps.key();
		const stated = dockedPane.get();
		if (!this.#deps.docked()) {
			if (stated?.key === key) dockedPane.set(null);
			return;
		}
		const open = !this.#deps.closed();
		const pinned = this.#deps.pinned();
		if (stated?.key === key && stated.open === open && stated.pinned === pinned) return;
		dockedPane.set({ key, open, pinned });
	}

	/** Closes an open docked pane to its strip on a click outside it. Three clicks leave it open: a click on a pinned
	 *  pane, a click on a control of the docked pane, and a click on an option of a combobox inside the pane. A combobox
	 *  renders its options into the document, marked with the tag of the element that holds the combobox. */
	#onDocumentClick = (e: Event): void => {
		if (!this.#deps.docked() || this.#deps.closed() || this.#deps.pinned()) return;
		const path = e.composedPath();
		if (path.includes(this.#host) || path.some((node) => node instanceof Element && node.hasAttribute(SHU_ATTR.DOCK_CONTROLS))) return;
		const owner = e.target instanceof Element ? e.target.closest<HTMLElement>('ul[role="listbox"][data-combo-owner]')?.dataset.comboOwner : undefined;
		if (owner && holdsTag(this.#host, owner)) return;
		this.#deps.setClosed(true);
	};

	/** The height of the pane's positioning container. The open height is a share of it. */
	#containerHeight(): number {
		return (this.#host.offsetParent as HTMLElement | null)?.clientHeight || this.#host.offsetHeight || 1;
	}

	/** Follow the pointer in pixels, once a frame. */
	#onResizeMove(y: number): void {
		const drag = this.#drag;
		if (!drag || drag.framePending) return;
		drag.framePending = true;
		requestAnimationFrame(() => {
			drag.framePending = false;
			this.#host.style.height = `${draggedHeight(drag.startHeight, drag.startY, y, drag.containerHeight)}px`;
		});
	}

	/** Remembers the dragged height as a bounded share of the container, so the pane keeps its proportion at any size. */
	#onResizeEnd(): void {
		const drag = this.#drag;
		this.#drag = null;
		if (!drag) return;
		this.#deps.setHeight(draggedProportion(this.#host.offsetHeight, drag.containerHeight));
		this.#apply();
	}
}
