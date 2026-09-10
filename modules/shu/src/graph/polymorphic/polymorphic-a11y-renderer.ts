/**
 * The graph as an accessible document: an IGraphRenderer whose medium is semantic HTML. It is given the same placed
 * nodes and links every renderer is given: a node arrives typed and titled, a link as a directed predicate-labelled
 * statement: so the accessible reading and the WebGL view can't drift.
 *
 * Two-way: every draw rewrites the document and a status line announces what changed (a live region assistive tech
 * reads without moving focus), while the entries drive the graph through the host's own entries, activating an entry
 * opens the node, focusing one highlights it: the same paths a pointer takes.
 *
 * The reading is a script: one list in the order records were made, each line saying who it belongs to where it
 * belongs to anyone, with what it points at beneath it and a way to each of those. It states a stretch at a time and
 * carries on from where it stopped, so a graph of any size is readable and no repaint builds all of it. All text
 * lands via textContent, so node names need no escaping.
 */
import { linkEndId, type FGNode } from "../polymorphic/polymorphic-graph-types.js";
import { graphSummary, type IGraphRenderer, type TDrawn } from "../polymorphic/polymorphic-renderer.js";
import { SHU_TEST_IDS } from "../../test-ids.js";

/** What the medium needs from its host. */
export type TA11yRendererDeps = {
	/** The DOM region this renderer owns: it manages the region's whole subtree. */
	region(): HTMLElement | null | undefined;
	/** Time reads along z in the lane views (gantt, sequence): entries sort into one ordered list: the story order. */
	/** The actor bars the active view draws, each with the nodes attached to it in appearance order, null when the
	 *  view is not built on actors. The document then reads as the picture does: one section per bar. */
	bars(): Array<{ id: string; label: string; nodeIds: string[] }> | null;
	/** Open the node: the same entry a pointer click drives. */
	onActivate(id: string): void;
	/** Highlight the node in the visual media: the same entry a pointer hover drives. */
	onFocus(id: string): void;
};

const NODE_ID_ATTR = "data-node-id";

const idOfEvent = (e: Event): string | null => (e.target as Element | null)?.closest?.(`[${NODE_ID_ATTR}]`)?.getAttribute(NODE_ID_ATTR) ?? null;

/** How many lines a reading states at a time. Not a limit on what can be read: the reading goes on from where it
 *  stopped, one press at a time, so a reader reaches any of it without a repaint ever building all of it. */
const READING_LINES = 200;

/** How many of a node's edges a reading states before it says how many are left. A record that stands for hundreds of
 *  others (a cluster) points at every one of them, and transcribing that is not a reading of anything. */
const EDGE_LINES = 6;

/** One edge as a reading states it: what it is, what it points at, and how many times it points there. */
type TEdgeLine = { predicate: string; targetId: string; targetName: string; count: number };

/** A node's edges as a reading states them: the same edge twice is said once with its count, a few are stated, and how
 *  many are left is said, so nothing is quietly dropped. */
function linesFor(edges: Map<string, TEdgeLine> | undefined): { shown: TEdgeLine[]; rest: number } {
	const said = edges ? [...edges.values()] : [];
	return { shown: said.slice(0, EDGE_LINES), rest: Math.max(0, said.length - EDGE_LINES) };
}

/** When a node was made: the time it was written down, not the time it is about, and not whatever places depth. A node
 *  with no such time reads last, so an undated record never displaces a dated one. */
const created = (n: FGNode | undefined): number => n?.__created ?? Number.POSITIVE_INFINITY;

/** Oldest first, by name where two were made at once, so a reading is stable between draws. */
const byCreated = (group: FGNode[]): FGNode[] => [...group].sort((a, b) => created(a) - created(b) || (a.name ?? a.id).localeCompare(b.name ?? b.id));

export class A11yRenderer implements IGraphRenderer {
	private lastIds = new Set<string>();
	/** How much of the reading is stated now, and the draw it was stated from: a reader asks for more of the same
	 *  reading, which is the last one drawn rather than a new one. */
	private reading = READING_LINES;
	private lastDrawn?: TDrawn;
	private wired: HTMLElement | null = null;
	private statusEl?: HTMLElement;
	private contentEl?: HTMLElement;

	constructor(private readonly deps: TA11yRendererDeps) {}

	size(): void {
		// a document has no pixel size; the host's CSS decides how the region shows
	}

	rebuildNodes(): void {
		// node shapes are a visual concern; the document rebuilds whole at every draw
	}

	/** The persistent frame inside the region: ONE status live region (recreating a live region misses announcements:
	 *  assistive tech watches an existing element for changes) and one content holder, wired with delegated listeners
	 *  once per region element. */
	private frame(region: HTMLElement): { status: HTMLElement; content: HTMLElement } {
		if (this.wired !== region || !this.statusEl || !this.contentEl) {
			this.wired = region;
			region.textContent = "";
			const doc = region.ownerDocument;
			this.statusEl = doc.createElement("p");
			this.statusEl.setAttribute("role", "status");
			this.contentEl = doc.createElement("div");
			region.append(this.statusEl, this.contentEl);
			region.addEventListener("click", (e) => {
				const id = idOfEvent(e);
				if (id) this.deps.onActivate(id);
			});
			region.addEventListener("focusin", (e) => {
				const id = idOfEvent(e);
				if (id) this.deps.onFocus(id);
			});
		}
		return { status: this.statusEl, content: this.contentEl };
	}

	draw({ nodes, links }: TDrawn): void {
		this.lastDrawn = { nodes, links };
		const region = this.deps.region();
		if (!region) throw new Error("A11yRenderer: no region to draw into");
		const { status, content } = this.frame(region);
		const doc = region.ownerDocument;

		const byId = new Map(nodes.map((n) => [n.id, n]));
		const edgesOf = new Map<string, Map<string, TEdgeLine>>();
		for (const l of links) {
			const s = byId.get(linkEndId(l.source));
			const t = byId.get(linkEndId(l.target));
			if (!s || !t) throw new Error(`A11yRenderer: link ${l.predicate} names a node that was not drawn`);
			// An arrow, not a colon: a colon reads as "this field holds that value", and these are edges: this record
			// points at that one. The reading says which way, since the picture does.
			const lines = edgesOf.get(s.id) ?? new Map<string, TEdgeLine>();
			const key = `${l.predicate} → ${t.id}`;
			const already = lines.get(key);
			if (already) already.count++;
			else lines.set(key, { predicate: l.predicate, targetId: t.id, targetName: t.name || t.id, count: 1 });
			edgesOf.set(s.id, lines);
		}

		const ids = new Set(nodes.map((n) => n.id));
		let added = 0;
		for (const id of ids) if (!this.lastIds.has(id)) added++;
		let removed = 0;
		for (const id of this.lastIds) if (!ids.has(id)) removed++;
		const summary = graphSummary({ nodes, links });
		status.textContent = this.lastIds.size && (added || removed) ? `${added} added, ${removed} removed, ${summary}` : summary;
		this.lastIds = ids;

		// A repaint must not throw the reader out: remember which entry holds focus and restore it on the new document.
		const focusedId = doc.activeElement?.closest?.(`[${NODE_ID_ATTR}]`)?.getAttribute(NODE_ID_ATTR) ?? null;
		let refocus: HTMLElement | undefined;

		content.textContent = "";
		// ONE reading, in the order things were made: a script of what happened, each line saying who it belongs to and
		// what it is. Grouping split the same events into piles a reader had to reassemble; a script does not.
		const actorOf = new Map<string, string>();
		for (const bar of this.deps.bars() ?? []) for (const id of bar.nodeIds) actorOf.set(id, bar.label);
		const script = byCreated(nodes);
		const stated = script.slice(0, Math.min(this.reading, script.length));
		const list = doc.createElement("ol");
		const counted = stated.length < script.length ? `${stated.length} of ${script.length} so far` : `${script.length}`;
		list.setAttribute("aria-label", `the graph as a script, in the order it was made (${counted})`);
		for (const n of stated) {
			const li = doc.createElement("li");
			const who = actorOf.get(n.id);
			if (who) li.append(doc.createTextNode(`${who}: `));
			const b = doc.createElement("button");
			b.type = "button";
			b.setAttribute(NODE_ID_ATTR, n.id);
			b.textContent = `${n.name || n.id} (${n.type})`;
			if (n.id === focusedId) refocus = b;
			li.append(b);
			const { shown, rest } = linesFor(edgesOf.get(n.id));
			if (shown.length) {
				const ul = doc.createElement("ul");
				for (const line of shown) {
					// The target is the way to it: a reader who cannot see the picture follows the graph by its own
					// relationships, which is what clicking a node and looking at its neighbours is for everyone else.
					const el = doc.createElement("li");
					el.append(doc.createTextNode(`${line.predicate} → `));
					const to = doc.createElement("button");
					to.type = "button";
					to.setAttribute(NODE_ID_ATTR, line.targetId);
					to.textContent = line.count > 1 ? `${line.targetName} (×${line.count})` : line.targetName;
					if (line.targetId === focusedId && !refocus) refocus = to;
					el.append(to);
					ul.append(el);
				}
				if (rest > 0) {
					const el = doc.createElement("li");
					el.textContent = `… and ${rest} more`;
					ul.append(el);
				}
				li.append(ul);
			}
			list.append(li);
		}
		// A reading that stopped somewhere and said so would leave a reader who cannot see the picture with no way to the
		// rest of it. It goes on from where it stopped instead, a press at a time: nothing is out of reach, and no single
		// repaint builds a document of tens of thousands of lines. Focus stays on the control, which is where the reader
		// is, and it announces how much more there is each time.
		if (script.length > stated.length) {
			const rest = doc.createElement("li");
			const more = doc.createElement("button");
			more.type = "button";
			more.setAttribute("data-testid", SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y_READ_ON);
			more.textContent = `read on: ${script.length - stated.length} more, in the same order`;
			more.addEventListener("click", () => {
				this.reading += READING_LINES;
				if (this.lastDrawn) this.draw(this.lastDrawn);
				this.deps.region()?.querySelector<HTMLElement>(`[data-testid="${SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y_READ_ON}"]`)?.focus();
			});
			rest.append(more);
			list.append(rest);
		}
		content.append(list);

		refocus?.focus();
	}
}
