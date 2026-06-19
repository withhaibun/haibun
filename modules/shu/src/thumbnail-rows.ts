/**
 * Group runs of consecutive screenshot thumbnails into a horizontal, wrapping `.thumb-row`. A run ends at
 * the next non-thumbnail element (a step line, prose, or a full-size artifact). Re-runnable: existing rows
 * are unwrapped first, so an incremental append re-groups cleanly. A thumbnail is an artifact container
 * holding a `shu-artifact-frame.thumb`.
 *
 * An artifact the view can't render (e.g. a dispatch trace) leaves an EMPTY placeholder div; in a run of
 * per-step screenshots those ghosts interleave between the thumbnails, and an empty div is a non-thumbnail
 * element that ends the run — so the screenshots never group. Drop the ghosts first so the thumbnails are
 * actually consecutive and flow one after another, wrapping.
 */
export function groupThumbnailRows(body: Element): void {
	for (const ghost of Array.from(body.querySelectorAll(".standalone-artifact:empty, .feature-artifacts:empty"))) ghost.remove();
	const isThumb = (el: Element) => !el.classList.contains("thumb-row") && !!el.querySelector("shu-artifact-frame.thumb");
	for (const row of Array.from(body.querySelectorAll(".thumb-row"))) {
		while (row.firstChild) body.insertBefore(row.firstChild, row);
		row.remove();
	}
	const children = Array.from(body.children);
	for (let i = 0; i < children.length; ) {
		if (!isThumb(children[i])) {
			i++;
			continue;
		}
		let j = i + 1;
		while (j < children.length && isThumb(children[j])) j++;
		const row = body.ownerDocument.createElement("div");
		row.className = "thumb-row";
		body.insertBefore(row, children[i]);
		for (let k = i; k < j; k++) row.appendChild(children[k]);
		i = j;
	}
}
