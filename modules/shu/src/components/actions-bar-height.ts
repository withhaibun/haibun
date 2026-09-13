/**
 * How the actions bar stands on the page: the strip it shows closed, the height it opens at, a drag of its top edge, the
 * pin that keeps it open against a click elsewhere, and the footprint its positioning host reserves for the closed
 * strip. An open bar overlays the views rather than resizing them, so it marks itself as covering them, and opening and
 * closing it opens and closes the bar's scope of the active record.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { ACTIONS_BAR_FOOTPRINT, SHU_ATTR } from "../consts.js";
import { SCOPE, dispatchSubjectEvent } from "../current-subject.js";
import { draggedHeight, draggedProportion, openAtProportion } from "./actions-bar-model.js";
import { startPointerDrag } from "./pointer-drag.js";

/** What the bar remembers of how it stands: whether it is open, whether it is pinned open, and its dragged height as a
 *  fraction of its container. */
export type THeightState = { askExpanded: boolean; pinned: boolean; heightProportion: number };

/** What the height reads from the bar: its state, the closed strip and the bar's frame once rendered, and the input a
 *  reader types into once the bar opens. */
export type TActionsBarHeightDeps = {
	state: () => THeightState;
	setState: (patch: Partial<THeightState>) => void;
	strip: () => { summary: HTMLElement; frame: HTMLElement } | null;
	focusInput: () => void;
};

export class ActionsBarHeight implements ReactiveController {
	readonly #host: ReactiveControllerHost & HTMLElement;
	readonly #deps: TActionsBarHeightDeps;
	/** The open height as a fraction of the container, read from the state once and kept after a drag. */
	#proportion: number | null = null;
	/** Whether the bar's scope of the active record was last raised open. */
	#scopeOpen = false;
	#footprintHost: HTMLElement | null = null;
	#footprint = -1;
	#footprintObserver: ResizeObserver | null = null;
	/** The drag in flight: where it began, the height and container height then, and how to stop it. */
	#drag: { startY: number; startHeight: number; containerHeight: number; framePending: boolean; stop: () => void } | null = null;

	constructor(host: ReactiveControllerHost & HTMLElement, deps: TActionsBarHeightDeps) {
		this.#host = host;
		this.#deps = deps;
		host.addController(this);
	}

	hostConnected(): void {
		document.addEventListener("click", this.#onDocumentClick, true);
		// The bar spans its container's width, so the strip wraps and its footprint changes with the window.
		this.#footprintObserver = new ResizeObserver(() => this.publishFootprint());
		this.#footprintObserver.observe(this.#host);
	}

	/** Before each render: the bar stands at its open height or at its strip, and its scope follows. */
	hostUpdate(): void {
		this.apply();
	}

	hostUpdated(): void {
		this.publishFootprint();
	}

	hostDisconnected(): void {
		if (this.#scopeOpen) dispatchSubjectEvent({ type: "close", scope: SCOPE.actionsBar });
		this.#scopeOpen = false;
		document.removeEventListener("click", this.#onDocumentClick, true);
		this.#drag?.stop();
		this.#drag = null;
		this.#footprintObserver?.disconnect();
		this.#footprintObserver = null;
		this.#footprintHost?.style.removeProperty(ACTIONS_BAR_FOOTPRINT);
		this.#footprintHost = null;
		this.#footprint = -1;
	}

	/** Open the bar, where it is closed. */
	open(): void {
		if (!this.#deps.state().askExpanded) this.#deps.setState({ askExpanded: true });
	}

	/** Open a bar that was pinned when it was last used. The bar calls this once its remembered state is restored. */
	openIfPinned(): void {
		if (this.#deps.state().pinned) this.open();
	}

	/** Open or close the bar, and focus the input when it opens. */
	toggle(): void {
		const opening = !this.#deps.state().askExpanded;
		this.#deps.setState({ askExpanded: opening });
		if (opening) requestAnimationFrame(() => this.#deps.focusInput());
	}

	/** The strip's disclosure control. It stops the click, so the strip's own toggle does not undo it. */
	onTwistyToggle = (e: Event): void => {
		e.stopPropagation();
		this.toggle();
	};

	/** The strip itself toggles the bar. */
	onStripClick = (): void => {
		this.toggle();
	};

	/** The pin latches the bar open against a click elsewhere. Pinning opens a closed bar; unpinning leaves it open. */
	onPinToggle = (e: Event): void => {
		e.stopPropagation();
		const { pinned, askExpanded } = this.#deps.state();
		this.#deps.setState({ pinned: !pinned, askExpanded: !pinned || askExpanded });
	};

	/** Start a drag of the top edge. The bar grows up from the bottom, so dragging the edge up makes it taller. */
	onResizeDown = (e: PointerEvent): void => {
		this.#drag?.stop();
		const stop = startPointerDrag(e, { onMove: (move) => this.#onResizeMove(move.clientY), onEnd: () => this.#onResizeEnd() });
		this.#drag = { startY: e.clientY, startHeight: this.#host.offsetHeight, containerHeight: this.#containerHeight(), framePending: false, stop };
		e.preventDefault();
	};

	/** Stand at the open height or the strip, mark whether the bar covers the views, and open or close its scope. */
	apply(): void {
		const open = this.#deps.state().askExpanded;
		this.#proportion ??= openAtProportion(this.#deps.state().heightProportion);
		this.#host.style.height = open ? `${(this.#proportion * 100).toFixed(2)}%` : "";
		this.#host.toggleAttribute(SHU_ATTR.DATA_COVERS_VIEWS, open);
		if (open === this.#scopeOpen) return;
		this.#scopeOpen = open;
		dispatchSubjectEvent({ type: open ? "open" : "close", scope: SCOPE.actionsBar });
	}

	/** Set the closed strip's height, with the bar's top border, on the positioning host, once per change. */
	publishFootprint(): void {
		const host = this.#host.offsetParent as HTMLElement | null;
		const strip = this.#deps.strip();
		if (!host || !strip) return;
		const height = Math.ceil(strip.summary.offsetHeight + (Number.parseFloat(getComputedStyle(strip.frame).borderTopWidth) || 0));
		if (host === this.#footprintHost && height === this.#footprint) return;
		this.#footprintHost = host;
		this.#footprint = height;
		host.style.setProperty(ACTIONS_BAR_FOOTPRINT, `${height}px`);
	}

	/** A click outside the bar closes it, unless it is pinned or the click picked one of its combobox's options, which the
	 *  combobox renders into the document marked with the bar's tag. */
	#onDocumentClick = (e: Event): void => {
		const { askExpanded, pinned } = this.#deps.state();
		if (!askExpanded || pinned || e.composedPath().includes(this.#host)) return;
		if (e.target instanceof Element && e.target.closest(`ul[role="listbox"][data-combo-owner="${this.#host.localName}"]`)) return;
		this.#deps.setState({ askExpanded: false });
	};

	/** The height of the bar's positioning container, which its open height is a fraction of. */
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

	/** Remember the dragged height as a bounded fraction of the container, so it stays proportionate at any size. */
	#onResizeEnd(): void {
		const drag = this.#drag;
		this.#drag = null;
		if (!drag) return;
		this.#proportion = draggedProportion(this.#host.offsetHeight, drag.containerHeight);
		this.#deps.setState({ heightProportion: this.#proportion });
		this.apply();
	}
}
