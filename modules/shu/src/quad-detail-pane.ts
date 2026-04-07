/**
 * Shared quad detail pane — renders a non-vertex quad as a column pane with
 * formatted JSON, clickable provenance links, and proper escaping.
 * Used by both shu-graph-view and shu-step-detail.
 */
import { SHU_EVENT } from "./consts.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

export function escHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Parse seqPath number array from event ID like "[1.2.3]" or "1.2.3". Returns undefined for non-numeric IDs. */
export function parseSeqPath(id: string): number[] | undefined {
	const cleaned = id.replace(/^\[|\]$/g, "");
	if (!cleaned || cleaned.includes(" ")) return undefined;
	const parts = cleaned.split(".");
	const nums = parts.map(Number);
	return nums.length > 0 && nums.every((n) => Number.isFinite(n) && !Number.isNaN(n)) ? nums : undefined;
}

/** Create and add a quad detail column pane. Provenance seqPaths are clickable. */
export function openQuadDetailPane(graph: string, subject: string, quads: TQuad[], dispatcher: EventTarget): void {
	const data: Record<string, unknown> = {};
	let provenance: number[][] | undefined;
	for (const q of quads) {
		let val = q.object;
		if (typeof val === "string") {
			try {
				val = JSON.parse(val);
			} catch {
				/* keep as string */
			}
		}
		data[q.predicate] = val;
		if (q.properties?.provenance) provenance = q.properties.provenance as number[][];
	}
	const json = JSON.stringify(data, null, 2);
	const escaped = escHtml(json);
	const provHtml = provenance?.length
		? `<div style="margin-top:6px"><b>Provenance:</b> ${provenance.map((sp) => `<a href="#" class="step-link" data-seqpath="${sp.join(",")}" style="color:#1a6b3c;cursor:pointer">[${sp.join(".")}]</a>`).join(" ")}</div>`
		: "";
	const html = `<div style="padding:8px;font-size:13px;overflow:auto"><h4 style="margin:0 0 6px">${escHtml(graph)}: ${escHtml(subject)}</h4><pre style="background:#f5f5f5;padding:8px;border-radius:4px;font-size:12px;white-space:pre-wrap;word-break:break-all">${escaped}</pre>${provHtml}</div>`;
	const pane = document.createElement("shu-column-pane");
	pane.setAttribute("label", `${graph}: ${subject.slice(0, 20)}`);
	pane.innerHTML = html;
	pane.querySelectorAll(".step-link").forEach((link) => {
		link.addEventListener("click", (e) => {
			e.preventDefault();
			const seqPath = (link as HTMLElement).dataset.seqpath?.split(",").map(Number);
			if (seqPath) dispatcher.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN_STEP, { detail: { seqPath }, bubbles: true, composed: true }));
		});
	});
	const strip = document.querySelector("shu-column-strip");
	if (strip && "addPane" in strip) (strip as HTMLElement & { addPane(p: HTMLElement): void }).addPane(pane);
}
