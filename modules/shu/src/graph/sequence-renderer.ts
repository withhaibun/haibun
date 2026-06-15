/**
 * SVG sequence paint: actor lifelines across the top and ordered messages flowing down, one row per message.
 * Renderer-agnostic of any trace shape — a consumer maps its events to `{ actors, messages }`. Each message is a
 * `<g class="seq-message" data-index>` so a consumer can dim or scroll messages by their order without re-rendering.
 */
import { xml, truncate, arrowMarker, ARROW_MARKER_ID, SVG_MARGIN as MARGIN } from "./svg-util.js";

export type TSeqActor = { id: string; label: string };
/** call: solid forward arrow; return: dashed reply arrow; denied: the call was refused (✕ at the target, no arrow). */
export type TSeqMessageKind = "call" | "return" | "denied";
export type TSeqMessage = { from: string; to: string; label: string; kind?: TSeqMessageKind; note?: string };
export type TSeqModel = { actors: TSeqActor[]; messages: TSeqMessage[] };

const COL_W = 170; // actor column pitch
const ACTOR_W = 140; // header box width
const ACTOR_H = 28;
const ROW_GAP = 18; // below the headers, before the first message
const ROW_H = 42; // vertical pitch between messages
const NOTE_W = 150;
const DENIED = "#a02828";
const NOTE_FILL = "#fffbe6";
const NOTE_STROKE = "#e0c84a";
const NOTE_FG = "#7a5b00";

const actorCX = (i: number): number => MARGIN + i * COL_W + COL_W / 2;

/** Pure SVG markup for a sequence (no DOM). Lifelines + header boxes first, then messages top to bottom. */
export function sequenceToSvg(model: TSeqModel): string {
	const { actors, messages } = model;
	const idx = new Map(actors.map((a, i) => [a.id, i]));
	const firstRowY = MARGIN + ACTOR_H + ROW_GAP;
	const height = firstRowY + Math.max(1, messages.length) * ROW_H + MARGIN;
	const lifelineTop = MARGIN + ACTOR_H;
	const lifelineBottom = height - MARGIN;

	let maxRight = MARGIN * 2 + Math.max(1, actors.length) * COL_W;
	for (const m of messages) {
		const ti = idx.get(m.to);
		if (m.note && ti !== undefined) maxRight = Math.max(maxRight, actorCX(ti) + 8 + NOTE_W + MARGIN);
	}
	const width = maxRight;

	const actorMarkup = actors
		.map((a, i) => {
			const cx = actorCX(i);
			return (
				`<g class="seq-actor" data-actor-id="${xml(a.id)}">` +
				`<line class="seq-lifeline" x1="${cx.toFixed(1)}" y1="${lifelineTop.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${lifelineBottom.toFixed(1)}" stroke="var(--shu-border)" stroke-dasharray="3 3"/>` +
				`<rect class="seq-actor-box" x="${(cx - ACTOR_W / 2).toFixed(1)}" y="${MARGIN}" width="${ACTOR_W}" height="${ACTOR_H}" rx="4" fill="var(--shu-bg-soft)" stroke="var(--shu-border)"/>` +
				`<text class="seq-actor-label" x="${cx.toFixed(1)}" y="${(MARGIN + ACTOR_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="12" fill="var(--shu-fg)">${xml(truncate(a.label, 18))}</text>` +
				`</g>`
			);
		})
		.join("");

	const msgMarkup = messages
		.map((m, i) => {
			const fi = idx.get(m.from);
			const ti = idx.get(m.to);
			if (fi === undefined || ti === undefined) return "";
			const y = firstRowY + i * ROW_H;
			const x1 = actorCX(fi);
			const x2 = actorCX(ti);
			const kind = m.kind ?? "call";
			const stroke = kind === "denied" ? DENIED : "var(--shu-fg-faded)";
			const dash = kind === "return" ? ` stroke-dasharray="5 3"` : "";
			const marker = kind === "denied" ? "" : ` marker-end="url(#${ARROW_MARKER_ID})"`;
			const line =
				fi === ti
					? `<path class="seq-message-line" d="M${x1.toFixed(1)},${y.toFixed(1)} h40 v16 h-40" fill="none" stroke="${stroke}"${dash}${marker}/>`
					: `<line class="seq-message-line" x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${stroke}"${dash}${marker}/>`;
			const labelFill = kind === "denied" ? DENIED : "var(--shu-fg-muted)";
			const label = `<text class="seq-message-label" x="${((x1 + x2) / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="${labelFill}">${xml(truncate(m.label, 32))}</text>`;
			const deny = kind === "denied" ? `<text class="seq-deny" x="${x2.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="13" fill="${DENIED}">✕</text>` : "";
			const note = m.note
				? `<g class="seq-note"><rect x="${(x2 + 8).toFixed(1)}" y="${(y - 9).toFixed(1)}" width="${NOTE_W}" height="18" rx="3" fill="${NOTE_FILL}" stroke="${NOTE_STROKE}"/><text x="${(x2 + 12).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="9" fill="${NOTE_FG}">${xml(truncate(m.note, 30))}</text></g>`
				: "";
			return `<g class="seq-message" data-index="${i}">${line}${label}${deny}${note}</g>`;
		})
		.join("");

	return `<svg class="shu-sequence-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" width="${width.toFixed(0)}" height="${height.toFixed(0)}"><defs>${arrowMarker()}</defs><g class="seq-actors">${actorMarkup}</g><g class="seq-messages">${msgMarkup}</g></svg>`;
}

/** Canonical text for a sequence (skip-when-unchanged key + copy artifact). */
export function sequenceToText(model: TSeqModel): string {
	const lines = ["sequence"];
	for (const a of model.actors) lines.push(`  actor ${a.id}`);
	for (const m of model.messages) {
		const arrow = m.kind === "return" ? "-->" : m.kind === "denied" ? "-x" : "->";
		lines.push(`  ${m.from} ${arrow} ${m.to}: ${m.label}${m.note ? `  // ${m.note}` : ""}`);
	}
	return lines.join("\n");
}
