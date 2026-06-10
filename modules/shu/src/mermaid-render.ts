/**
 * Server-side mermaid → SVG. mermaid needs a DOM with layout; jsdom provides the DOM but no layout, so node and
 * label sizes come from a text heuristic (a measuring `getBoundingClientRect` plus a leaf-only `getBBox`), which is
 * enough for mermaid's internal dagre layout. The diagram's `viewBox` — which mermaid derives from a single
 * `getBBox` on the root `<svg>`, a container jsdom can't measure — is recomputed after render by unioning the
 * laid-out geometry. Renders are serialized and the DOM globals are set only around each render, so the server
 * process is not left looking like a browser. (The metric constants are tuned to avoid label clipping; exact
 * pixels need not match a headed browser since the SVG uses width:100% + max-width and the browser scales it.)
 */
// @ts-expect-error — jsdom ships no bundled type declarations
import { JSDOM } from "jsdom";

type Mermaid = { initialize: (c: object) => void; render: (id: string, src: string) => Promise<{ svg: string }> };
type BBox = { x: number; y: number; width: number; height: number };
interface El {
	tagName?: string;
	textContent?: string | null;
	getAttribute(name: string): string | null;
	children: ArrayLike<El>;
}

const CHAR_PX = 8.5;
const LINE_PX = 19.5;
const PAD = 8;

let mermaid: Mermaid | undefined;
let chain: Promise<unknown> = Promise.resolve();
let counter = 0;

/** Approximate a label's box: `<br/>`/newlines are line breaks, tags are stripped. */
function measureText(text: string): { width: number; height: number } {
	const lines = text.split(/\n|<br\s*\/?>/i).map((l) => l.replace(/<[^>]*>/g, ""));
	const cols = Math.max(0, ...lines.map((l) => l.length));
	return { width: Math.max(8, cols * CHAR_PX), height: Math.max(16, lines.length * LINE_PX) };
}

function num(el: El, name: string): number {
	const v = el.getAttribute(name);
	const n = v == null ? 0 : parseFloat(v);
	return Number.isFinite(n) ? n : 0;
}

/** Bounds of a path's `d` from its coordinate pairs — rough, but enough for the diagram extent. */
function pathBounds(d: string): BBox {
	const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (let i = 0; i + 1 < nums.length; i += 2) {
		minX = Math.min(minX, nums[i]);
		minY = Math.min(minY, nums[i + 1]);
		maxX = Math.max(maxX, nums[i]);
		maxY = Math.max(maxY, nums[i + 1]);
	}
	return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : { x: 0, y: 0, width: 0, height: 0 };
}

function translateOf(el: El): { x: number; y: number } {
	const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)?/.exec(el.getAttribute("transform") ?? "");
	return { x: m ? parseFloat(m[1]) : 0, y: m?.[2] ? parseFloat(m[2]) : 0 };
}

/** A drawn box if this element is one (rect/foreignObject by attrs, path by its `d`), else undefined. */
function drawnBox(el: El): BBox | undefined {
	const tag = (el.tagName ?? "").toLowerCase();
	if (tag === "rect" || tag === "foreignobject") return { x: num(el, "x"), y: num(el, "y"), width: num(el, "width"), height: num(el, "height") };
	if (tag === "path") return pathBounds(el.getAttribute("d") ?? "");
	return undefined;
}

/**
 * Size an element the way getBBox would: a text/shape leaf from its own geometry, a container (group) from the union
 * of its children (each shifted by its own translate). Compound node shapes — subroutine `[[ ]]`, stadium, hexagon —
 * are drawn as a group, and mermaid calls getBBox on that group; returning a zero box for groups left the node
 * degenerate, so dagre routed no points for its edges and edge-label placement threw "no suitable point".
 */
function unionBBox(el: El): BBox {
	const tag = (el.tagName ?? "").toLowerCase();
	if (tag === "text" || tag === "tspan") return { x: 0, y: 0, ...measureText(el.textContent ?? "") };
	const own = drawnBox(el);
	if (own) return own;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const child of Array.from(el.children)) {
		const b = unionBBox(child);
		if (b.width <= 0 && b.height <= 0) continue;
		const t = translateOf(child);
		minX = Math.min(minX, t.x + b.x);
		minY = Math.min(minY, t.y + b.y);
		maxX = Math.max(maxX, t.x + b.x + b.width);
		maxY = Math.max(maxY, t.y + b.y + b.height);
	}
	return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : { x: 0, y: 0, width: 0, height: 0 };
}

function installStubs(win: { SVGElement: { prototype: Record<string, unknown> }; Element: { prototype: Record<string, unknown> } }): void {
	win.SVGElement.prototype.getBBox = function (this: El): BBox {
		return unionBBox(this);
	};
	win.Element.prototype.getBoundingClientRect = function (this: { textContent?: string | null }) {
		const { width, height } = measureText(this.textContent ?? "");
		return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height };
	};
}

/** Viewport the diagram should fill (the live graph-view's scroll area). Absent for the offline report, which scales responsively. */
type TFit = { width: number; height: number };

/** Recompute the diagram's `viewBox`/size from the laid-out geometry — mermaid set it from a root-`<svg>` getBBox jsdom can't measure. */
function fixViewBox(
	svg: string,
	win: { DOMParser: new () => { parseFromString(s: string, t: string): { documentElement: El } }; XMLSerializer: new () => { serializeToString(n: unknown): string } },
	fit?: TFit,
): string {
	const root = new win.DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const walk = (el: El, tx: number, ty: number): void => {
		const t = translateOf(el);
		const ox = tx + t.x;
		const oy = ty + t.y;
		const b = drawnBox(el);
		if (b && b.width > 0 && b.height > 0) {
			minX = Math.min(minX, ox + b.x);
			minY = Math.min(minY, oy + b.y);
			maxX = Math.max(maxX, ox + b.x + b.width);
			maxY = Math.max(maxY, oy + b.y + b.height);
		}
		for (const child of Array.from(el.children)) walk(child, ox, oy);
	};
	walk(root, 0, 0);
	if (!Number.isFinite(minX)) throw new Error("renderMermaid: no drawable geometry in the rendered SVG");
	const el = root as unknown as { setAttribute(n: string, v: string): void; removeAttribute(n: string): void };
	const w = maxX - minX + 2 * PAD;
	const h = maxY - minY + 2 * PAD;
	el.setAttribute("viewBox", `${minX - PAD} ${minY - PAD} ${w} ${h}`);
	if (fit) {
		// Live view: fill the sent viewport so the diagram uses the available vertical space (and the TD/LR
		// orientation is visible) instead of rendering at its natural pixel size capped narrow. `meet` scales
		// the whole diagram to fit; zoom + scroll handle detail beyond that.
		el.setAttribute("width", String(fit.width));
		el.setAttribute("height", String(fit.height));
		el.setAttribute("preserveAspectRatio", "xMidYMid meet");
		el.removeAttribute("style");
	} else {
		// Offline report: responsive width, natural height, capped so it never exceeds its content.
		el.setAttribute("width", "100%");
		el.removeAttribute("height");
		el.setAttribute("style", `max-width: ${w}px;`);
	}
	return new win.XMLSerializer().serializeToString(root);
}

async function renderOnce(source: string, fit?: TFit): Promise<string> {
	const dom = new JSDOM("<!DOCTYPE html><body></body>", { pretendToBeVisual: true });
	installStubs(dom.window);
	const g = globalThis as Record<string, unknown>;
	const savedDoc = g.document;
	const savedWin = g.window;
	g.document = dom.window.document;
	g.window = dom.window;
	try {
		if (!mermaid) {
			mermaid = ((await import("mermaid")) as unknown as { default: Mermaid }).default;
			mermaid.initialize({ startOnLoad: false, securityLevel: "loose", flowchart: { htmlLabels: true } });
		}
		const { svg } = await mermaid.render(`mr-${counter++}`, source);
		return fixViewBox(svg, dom.window, fit);
	} finally {
		g.document = savedDoc;
		g.window = savedWin;
	}
}

/** Render mermaid `source` to an SVG string, server-side. Calls are serialized so the transient DOM globals never overlap. */
export function renderMermaidToSvg(source: string, fit?: TFit): Promise<string> {
	const run = chain.then(() => renderOnce(source, fit));
	chain = run.catch(() => undefined);
	return run;
}
