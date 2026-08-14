/**
 * The graph as markup: an IGraphRenderer whose medium is SVG, for a report or a still image. It is given the same
 * placed nodes and links every renderer is given, so a still shows exactly what the WebGL view shows — same positions,
 * same type colours — with nothing computed twice.
 *
 * The markup is self-contained (concrete colours, no CSS variables), since a still leaves the app: it is embedded in a
 * report, printed, or opened on its own.
 */
import { colorForType } from "../../type-colors.js";
import { xml } from "../svg-util.js";
import { ellipsize } from "@haibun/core/lib/util/index.js";
import { NODE_TEXT_COLOR } from "./layout-forces.js";
import { linkEndId, type FGNode } from "./polymorphic-graph-types.js";
import { graphSummary, type IGraphRenderer, type TDrawn } from "./polymorphic-renderer.js";

/** What the medium needs from its host, read at draw time. */
export type TSvgRendererDeps = {
	/** Time reads left to right in the lane views (gantt, sequence), where z is the calendar axis; x carries it elsewhere. */
	timeIsHorizontal(): boolean;
};

const PAD = 40; // world units of margin around the drawn extent
const NODE_R = 6;
const LABEL_MAX = 40;
const PAPER = "#ffffff";
const LINE = "#9aa0a6";

const round = (n: number): number => Math.round(n * 10) / 10;

export class SvgRenderer implements IGraphRenderer {
	/** The markup of the most recent draw — empty until one happens. */
	markup = "";

	constructor(private readonly deps: TSvgRendererDeps) {}

	size(): void {
		// the document sizes itself from the drawn extent, so a still is never letterboxed to a window it never had
	}

	rebuildNodes(): void {
		// markup rebuilds whole at every draw, so a shape change needs no separate signal
	}

	draw({ nodes, links }: TDrawn): void {
		// The still is 2D: the vertical axis is y (flipped — SVG y grows downward), and the horizontal axis is x, except
		// in the lane views where z carries the calendar and the camera faces the lane plane — the still faces it too.
		const h = this.deps.timeIsHorizontal() ? (n: FGNode): number => n.z ?? 0 : (n: FGNode): number => n.x ?? 0;
		const v = (n: FGNode): number => -(n.y ?? 0);
		const xs = nodes.map(h);
		const ys = nodes.map(v);
		const minX = Math.min(0, ...xs) - PAD;
		const minY = Math.min(0, ...ys) - PAD;
		const w = Math.max(...xs, 0) + PAD - minX;
		const ht = Math.max(...ys, 0) + PAD - minY;

		const byId = new Map(nodes.map((n) => [n.id, n]));
		const lines = links.map((l) => {
			const s = byId.get(linkEndId(l.source));
			const t = byId.get(linkEndId(l.target));
			if (!s || !t) throw new Error(`SvgRenderer: link ${l.predicate} names a node that was not drawn`);
			const [x1, y1, x2, y2] = [h(s), v(s), h(t), v(t)].map(round);
			const label = xml(l.predicate);
			return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${LINE}" stroke-width="0.6"/><text x="${round((x1 + x2) / 2)}" y="${round((y1 + y2) / 2)}" font-size="5" fill="${LINE}" text-anchor="middle">${label}</text>`;
		});
		const chips = nodes.map((n) => {
			const label = xml(ellipsize(n.name ?? n.id, LABEL_MAX));
			const [x, y] = [round(h(n)), round(v(n))];
			return `<circle cx="${x}" cy="${y}" r="${NODE_R}" fill="${colorForType(n.type)}" stroke="${NODE_TEXT_COLOR}" stroke-width="0.5"/><text x="${round(x + NODE_R + 2)}" y="${round(y + 2)}" font-size="6" fill="${NODE_TEXT_COLOR}">${label}</text>`;
		});

		this.markup = [
			`<svg xmlns="http://www.w3.org/2000/svg" width="${round(w)}" height="${round(ht)}" viewBox="${round(minX)} ${round(minY)} ${round(w)} ${round(ht)}" font-family="sans-serif">`,
			// The still carries its own text alternative (SVG title + desc), so the report artifact is readable without the picture.
			"<title>graph still</title>",
			`<desc>${xml(graphSummary({ nodes, links }))}</desc>`,
			`<rect x="${round(minX)}" y="${round(minY)}" width="${round(w)}" height="${round(ht)}" fill="${PAPER}"/>`,
			...lines, // lines under chips, the same order the scene layers them
			...chips,
			"</svg>",
		].join("\n");
	}
}
