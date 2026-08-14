/**
 * One way to drag anything in this app: press, follow the pointer wherever it goes, and stop when it is released,
 * cancelled or the view holding it goes away. A pointer is a mouse, a finger and a pen alike, so a control written
 * once this way works with all three rather than needing a second set of touch handlers beside its mouse ones.
 *
 * The moves are read from the document, not from the pressed element, so a pointer dragged off the control keeps
 * driving it, and the drag is keyed to the pointer that started it, so a second finger cannot take one over.
 */

export type TPointerDrag = {
	/** Where the pointer is now. Called for every move of the pointer that started the drag. */
	onMove: (e: PointerEvent) => void;
	/** The drag is over: released or cancelled. Not called when the drag is stopped by its own holder. */
	onEnd?: (e: PointerEvent) => void;
};

/** Begin a drag from the press that started it, and return the way to stop it (a view tears its drags down this way). */
export function startPointerDrag(start: PointerEvent, { onMove, onEnd }: TPointerDrag): () => void {
	const id = start.pointerId;
	const ac = new AbortController();
	const opts = { signal: ac.signal };
	const ended = (e: Event): void => {
		const pe = e as PointerEvent;
		if (pe.pointerId !== id) return;
		ac.abort();
		onEnd?.(pe);
	};
	document.addEventListener("pointermove", (e) => (e as PointerEvent).pointerId === id && onMove(e as PointerEvent), opts);
	document.addEventListener("pointerup", ended, opts);
	document.addEventListener("pointercancel", ended, opts);
	return () => ac.abort();
}
