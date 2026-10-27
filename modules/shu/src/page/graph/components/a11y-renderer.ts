/**
 * The graph as an accessible document: an TGraphRenderer whose medium is semantic HTML. It is given the same placed
 * nodes and links every renderer is given: a node arrives typed and titled, a link as a directed predicate-labelled
 * statement: so the accessible reading and the WebGL view can't drift.
 *
 * Two-way: every draw rewrites the document and a status line announces what changed (a live region assistive tech
 * reads without moving focus), while the entries drive the graph through the host's own entries, activating an entry
 * opens the node, focusing one highlights it: the same paths a pointer takes.
 *
 * The reading is a script: one list in the order records were made, each line naming its actor where it has one,
 * with what it points at beneath it and a way to each of those. It states a stretch at a time and
 * carries on from where it stopped, so a graph of any size is readable and a repaint doesn't build all of it. All text
 * lands via textContent, so node names don't need escaping.
 *
 * It states what the picture shows of each node as the picture shows it: a node by what its chip reads, the active node as
 * the current entry, a node the reader dropped as pinned, a node a focus or a preview dims as dimmed, the title of each box
 * drawn around a group, and that the graph is busy while what it shows still changes.
 */
import { linkEndId, type FGNode } from "../domains/graph-types.js";
import { READ_STATE } from "../domains/views.js";
import { graphSummary } from "./renderer.js";
import type { TDrawn, TGraphRenderer } from "../ports.js";
import type { FocusState } from "../derivations/focus-policy.js";
import { SHU_TEST_IDS } from "../../../domains/test-ids.js";

/** What the medium needs from its host. */
export type TA11yRendererDeps = {
	/** The DOM region this renderer owns: it manages the region's whole subtree. */
	region(): HTMLElement | null | undefined;
	/** Time reads along z in the lane views (gantt, sequence): entries sort into one ordered list: the story order. */
	/** The actor bars the active view draws, each with the nodes attached to it in appearance order, null when the
	 *  view is not built on actors. The document then reads as the picture does: one section per bar. */
	bars(): Array<{ id: string; label: string; nodeIds: string[] }> | null;
	/** What a node's chip reads, which names its entry: its name, or the value that places its depth where chips read that. */
	labelOf(n: FGNode): string;
	/** What the picture shows of the nodes now. */
	marks(): TReadingMarks;
	/** The title of each box the picture draws around a group, empty while the view doesn't group its nodes. */
	groups(): readonly string[];
	/** Open the node: the same entry a pointer click drives. */
	onActivate(id: string): void;
	/** Highlight the node in the visual media: the same entry a pointer hover drives. */
	onFocus(id: string): void;
};

/** What the picture shows of the nodes: the active node, each node's focus tier, and the nodes the reader dropped. */
export type TReadingMarks = { active: string | null; tierOf: (n: FGNode) => FocusState; pinned: (id: string) => boolean };

const NODE_ID_ATTR = "data-node-id";
const DIMMED: FocusState = "dimmed";

/** A button that is the way to node `id`: activating it opens the node, focusing it hovers the node. */
const wayTo = (doc: Document, id: string): HTMLButtonElement => {
	const b = doc.createElement("button");
	b.type = "button";
	b.setAttribute(NODE_ID_ATTR, id);
	return b;
};
/** A node's line of the script, holding the entry that is the way to the node. */
const newLine = (doc: Document, id: string): { li: HTMLLIElement; entry: HTMLButtonElement } => {
	const li = doc.createElement("li");
	const entry = wayTo(doc, id);
	li.append(entry);
	return { li, entry };
};
const idOfEvent = (e: Event): string | null => (e.target as Element | null)?.closest?.(`[${NODE_ID_ATTR}]`)?.getAttribute(NODE_ID_ATTR) ?? null;

/** How many lines a reading states at a time. Not a limit on what can be read: the reading goes on from where it
 *  stopped, one press at a time, so a reader reaches any of it without a repaint ever building all of it. */
const READING_LINES = 200;

/** How many of a node's edges a reading states before it states how many are left. A record that stands for hundreds of
 *  others (a cluster) points at every one of them, and transcribing that is not a reading of anything. */
const EDGE_LINES = 6;

/** One edge as a reading states it: what it is, what it points at, and how many times it points there. */
type TEdgeLine = { predicate: string; targetId: string; targetName: string; count: number };

/** A node's edges as a reading states them: the same edge twice is listed once with its count, a few are stated, and how
 *  many are left is stated, so an edge isn't dropped quietly. */
function linesFor(edges: Map<string, TEdgeLine> | undefined): { shown: TEdgeLine[]; rest: number } {
	const said = edges ? [...edges.values()] : [];
	return { shown: said.slice(0, EDGE_LINES), rest: Math.max(0, said.length - EDGE_LINES) };
}

/** The order of two nodes by when each was made: the time it was written down, not the time it is about, and not whatever
 *  places depth. A node without such a time reads after every dated one, so an undated record never displaces a dated one. */
const createdOrder = ({ __created: a }: FGNode, { __created: b }: FGNode): number => {
	if (a === undefined) return b === undefined ? 0 : 1;
	return b === undefined ? -1 : a - b;
};

/** Oldest first, by name where two were made at once, so a reading is stable between draws. */
const byCreated = (group: FGNode[]): FGNode[] => [...group].sort((a, b) => createdOrder(a, b) || (a.name ?? a.id).localeCompare(b.name ?? b.id));

export class A11yRenderer implements TGraphRenderer {
	private lastIds = new Set<string>();
	/** How much of the reading is stated now, and the draw it was stated from: a reader asks for more of the same
	 *  reading, which is the last one drawn rather than a new one. */
	private reading = READING_LINES;
	private lastDrawn?: TDrawn;
	private wired: HTMLElement | null = null;
	private statusEl?: HTMLElement;
	private contentEl?: HTMLElement;
	/** The script the content holds: its list, each node's line by id with the entry that is the way to the node, and the
	 *  line that reads on past where the script stops. */
	private script?: { list: HTMLOListElement; lines: Map<string, { li: HTMLLIElement; entry: HTMLButtonElement }>; readOn?: HTMLLIElement };
	/** Whether the region states that what the graph shows still changes. */
	private busyNow: boolean | undefined;

	constructor(private readonly deps: TA11yRendererDeps) {}

	size(): void {
		// a document doesn't have a pixel size; the host's CSS sets how the region shows
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
			this.script = undefined;
			region.append(this.statusEl, this.contentEl);
			// A press on an entry opens its node, and the focus the press gives the entry doesn't highlight the node first: a
			// highlight restates the other entries dimmed, which reflows the list, and the entry would move from under the
			// press before it ends, so the press would end on another element and wouldn't open the node.
			let pressing = false;
			region.addEventListener("pointerdown", () => {
				pressing = true;
			});
			region.addEventListener("click", (e) => {
				pressing = false;
				const id = idOfEvent(e);
				if (id) this.deps.onActivate(id);
			});
			region.addEventListener("focusin", (e) => {
				const pressed = pressing;
				pressing = false;
				const id = idOfEvent(e);
				if (id && !pressed) this.deps.onFocus(id);
			});
		}
		return { status: this.statusEl, content: this.contentEl };
	}

	draw({ nodes, links }: TDrawn): void {
		this.lastDrawn = { nodes, links };
		const region = this.deps.region();
		if (!region) throw new Error("A11yRenderer: it doesn't have a region to draw into");
		const { status, content } = this.frame(region);
		const doc = region.ownerDocument;

		const byId = new Map(nodes.map((n) => [n.id, n]));
		const groups = this.deps.groups();
		const edgesOf = new Map<string, Map<string, TEdgeLine>>();
		for (const l of links) {
			const s = byId.get(linkEndId(l.source));
			const t = byId.get(linkEndId(l.target));
			if (!s || !t) throw new Error(`A11yRenderer: link ${l.predicate} names a node that was not drawn`);
			// An arrow, not a colon: a colon reads as "this field holds that value", and these are edges: this record
			// points at that one. The reading states which way, since the picture does.
			let lines = edgesOf.get(s.id);
			if (lines === undefined) {
				lines = new Map<string, TEdgeLine>();
				edgesOf.set(s.id, lines);
			}
			const key = `${l.predicate} → ${t.id}`;
			const already = lines.get(key);
			if (already) already.count++;
			else lines.set(key, { predicate: l.predicate, targetId: t.id, targetName: this.deps.labelOf(t), count: 1 });
		}

		const ids = new Set(nodes.map((n) => n.id));
		let added = 0;
		for (const id of ids) if (!this.lastIds.has(id)) added++;
		let removed = 0;
		for (const id of this.lastIds) if (!ids.has(id)) removed++;
		const summary = graphSummary({ nodes, links });
		status.textContent = this.lastIds.size && (added || removed) ? `${added} added, ${removed} removed, ${summary}` : summary;
		this.lastIds = ids;

		// A repaint must not throw the reader out: note which entry holds focus and restore it on the new document.
		const focusedId = doc.activeElement?.closest?.(`[${NODE_ID_ATTR}]`)?.getAttribute(NODE_ID_ATTR) ?? null;
		let refocus: HTMLElement | undefined;
		// ONE reading, in the order things were made: a script of what happened, each line naming its actor and
		// what it is. Grouping split the same events into piles a reader had to reassemble; a script does not. Before it,
		// the titles of the boxes the picture draws around groups, and the lifelines of a view built on actors, each of which
		// the picture labels whether or not a line stands on it.
		const actorOf = new Map<string, string>();
		const bars = this.deps.bars(); // null off a view built on actors, where a line doesn't name one
		if (bars !== null) for (const bar of bars) for (const id of bar.nodeIds) actorOf.set(id, bar.label);
		for (const testId of [SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y_GROUPS, SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y_LANES])
			content.querySelector(`:scope > [data-testid="${testId}"]`)?.remove();
		const titled: Array<[string, string, readonly string[]]> = [
			[SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y_GROUPS, "the boxes drawn around groups", groups],
			[SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y_LANES, "the lifelines the view draws", bars === null ? [] : bars.map((bar) => bar.label)],
		];
		for (const [testId, label, titles] of titled) {
			if (titles.length === 0) continue;
			const list = doc.createElement("ul");
			list.setAttribute("data-testid", testId);
			list.setAttribute("aria-label", label);
			for (const title of titles) {
				const li = doc.createElement("li");
				li.textContent = title;
				list.append(li);
			}
			content.insertBefore(list, this.script?.list ?? null);
		}
		const script = byCreated(nodes);
		const stated = script.slice(0, Math.min(this.reading, script.length));
		if (this.script === undefined) {
			this.script = { list: doc.createElement("ol"), lines: new Map() };
			content.append(this.script.list);
		}
		const { list, lines } = this.script;
		const counted = stated.length < script.length ? `${stated.length} of ${script.length} so far` : `${script.length}`;
		list.setAttribute("aria-label", `the graph as a script, in the order it was made (${counted})`);
		// A node's line stays on the document, the same element, while a draw restates it: a press a repaint lands within ends
		// on the entry it began on and opens the node, where a press across a rebuilt line ends on another element, and is lost.
		const statedIds = new Set(stated.map((n) => n.id));
		for (const [id, { li }] of lines) {
			if (statedIds.has(id)) continue;
			li.remove();
			lines.delete(id);
		}
		this.script.readOn?.remove();
		let next: ChildNode | null = list.firstChild;
		for (const n of stated) {
			const { li, entry } = lines.get(n.id) ?? newLine(doc, n.id);
			lines.set(n.id, { li, entry });
			for (const child of [...li.childNodes]) if (child !== entry) child.remove();
			const who = actorOf.get(n.id);
			if (who) li.insertBefore(doc.createTextNode(`${who}: `), entry);
			if (n.id === focusedId) refocus = entry;
			const { shown, rest } = linesFor(edgesOf.get(n.id));
			if (shown.length) {
				const ul = doc.createElement("ul");
				for (const edge of shown) {
					// The target is the way to it: a reader who cannot see the picture follows the graph by its own
					// relationships, which is what clicking a node and looking at its neighbours is for everyone else.
					const el = doc.createElement("li");
					el.append(doc.createTextNode(`${edge.predicate} → `));
					const to = wayTo(doc, edge.targetId);
					to.textContent = edge.count > 1 ? `${edge.targetName} (×${edge.count})` : edge.targetName;
					if (edge.targetId === focusedId && !refocus) refocus = to;
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
			if (li === next) next = li.nextSibling;
			else list.insertBefore(li, next);
		}
		// A reading that stopped somewhere and stated so would leave a reader who cannot see the picture without a way to the
		// rest of it. It goes on from where it stopped instead, a press at a time: the reader can reach every part, and a single
		// repaint doesn't build a document of tens of thousands of lines. Focus stays on the control, which is where the reader
		// is, and it announces how much more there is each time.
		this.script.readOn = undefined;
		if (script.length > stated.length) {
			const readOn = doc.createElement("li");
			const more = doc.createElement("button");
			more.type = "button";
			more.setAttribute("data-testid", SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y_READ_ON);
			more.textContent = `read on: ${script.length - stated.length} more, in the same order`;
			more.addEventListener("click", () => {
				this.reading += READING_LINES;
				if (this.lastDrawn) this.draw(this.lastDrawn);
				this.deps.region()?.querySelector<HTMLElement>(`[data-testid="${SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y_READ_ON}"]`)?.focus();
			});
			readOn.append(more);
			list.append(readOn);
			this.script.readOn = readOn;
		}
		this.mark();

		refocus?.focus();
	}

	/** State on each entry what the picture shows of its node now, in place, so the entry a reader is on keeps their focus. */
	mark(): void {
		const drawn = this.lastDrawn;
		const content = this.contentEl;
		if (drawn === undefined || content === undefined) return;
		const { active, tierOf, pinned } = this.deps.marks();
		const byId = new Map(drawn.nodes.map((n) => [n.id, n]));
		for (const entry of content.querySelectorAll<HTMLElement>(`ol > li > [${NODE_ID_ATTR}]`)) {
			const id = entry.getAttribute(NODE_ID_ATTR);
			const n = id === null ? undefined : byId.get(id);
			if (n === undefined) throw new Error(`A11yRenderer: an entry names node ${id}, which the last draw doesn't hold`);
			const states = [n.type, ...(pinned(n.id) ? [READ_STATE.pinned] : []), ...(tierOf(n) === DIMMED ? [READ_STATE.dimmed] : [])];
			entry.textContent = `${this.deps.labelOf(n)} (${states.join(", ")})`;
			if (n.id === active) entry.setAttribute("aria-current", "true");
			else entry.removeAttribute("aria-current");
		}
	}

	/** State whether what the graph shows still changes: a reader waits while the region is busy, and a live region's change
	 *  is announced once it isn't. */
	busy(on: boolean): void {
		if (on === this.busyNow) return;
		const region = this.deps.region();
		if (!region) throw new Error("A11yRenderer: it doesn't have a region to state the graph busy in");
		this.busyNow = on;
		region.setAttribute("aria-busy", String(on));
	}
}
