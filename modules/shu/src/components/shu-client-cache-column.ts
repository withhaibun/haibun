/**
 * <shu-client-cache-column> — what this page caches of the run, as it stands: each run source (one per level read) with
 * its extent, the index spans it caches and the row the shared cursor sits on in it; what the live stream has
 * delivered since the view opened, by level; what the device's event store caches of the last run, by level; and every
 * IndexedDB database of the origin with its stores and their counts. It requests nothing of the server: a source is
 * listed once a view has read its level, and the store is read as it is. A reader makes one change here, which is to
 * forget a run this device holds. It watches everything that moves —
 * each source as it is made and as it changes, every live batch, the cursor — and shows the change at once; the device
 * is re-read after changes at a bounded cadence, since reading it is slower than the stream. Every value carries its own
 * test id (SHU_TEST_IDS.CLIENT_CACHE), so this one view is what a feature reads cache facts from. It also reports where
 * the server's registry the page runs on came from: the server, or the device's copy when the server did not respond.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { SHU_TEST_IDS } from "../test-ids.js";

import { subscribeBatchedEvents } from "../event-stream.js";
import { currentRowIndex } from "../virtual-column-model.js";

import type { Range } from "../ranges.js";
import { HAIBUN_LOG_LEVELS } from "@haibun/core/schema/protocol.js";
import { registryOrigin } from "../rpc-registry.js";
import { serverLastRespondedAt } from "../hypermedia.js";
import { emptyOrLoading } from "./empty-state.js";
import {
	runSources,
	runReadingAt,
	deviceStore,
	subscribeRunSources,
	subscribeDeviceWrites,
	CACHE_SHAPE,
	type TStoredRegistry,
	atLiveEdge,
	executionsHeld,
	forgetExecution,
	currentExecution,
	readExecution,
	subscribeExecutionSwitch,
	EXECUTIONS_READ,
	type THeldExecution,
	type RunSource,
	indexedDbSummary,
	type TIdbDatabaseSummary,
} from "../client-cache/index.js";

const EmptySchema = z.object({});
const IDS = SHU_TEST_IDS.CLIENT_CACHE;
/** How soon after a change the device is read again: the stream can change many times a second, the device once in this.
 *  Short enough that what the device caches is reported as it happens, long enough that a burst is one read. */
export const DEVICE_READ_DELAY_MS = 150;

const at = (t: number | undefined): string => (t === undefined || !Number.isFinite(t) ? "" : new Date(t).toISOString().slice(11, 23));
/** The feature the run being read declared, from the first rows of it a view has read. A run declares its feature at
 *  its start, so this reads the first rows rather than the run. */
function featureBeingRead(sources: RunSource[]): string {
	for (const source of sources) {
		for (const { from, to } of source.cachedRanges()) {
			for (let i = from; i < Math.min(to, from + FEATURE_WITHIN_ROWS); i++) {
				const row = source.rowAt(i) as { type?: string; featureName?: string } | undefined;
				if (row?.type === "feature" && row.featureName) return row.featureName;
			}
		}
	}
	return "";
}

/** How far into a run its feature declaration is looked for: a run declares it at its start. */
const FEATURE_WITHIN_ROWS = 20;

/** What a source is doing, as the one word a reader reads it by. It is the cell's own id as well, so what a reader
 *  waits for is the state itself rather than a cell that may still be about to change. */
/** What a source is doing, one word a reader waits for: not yet read, cut off from the run, behind what the run has
 *  announced, or read and current. Each is a fact of the reading, so none is inferred from what happens to arrive. */
const stateOf = (source: RunSource): string =>
	source.unavailable ? "unavailable" : source.ended ? "ended" : !source.loaded ? "loading" : source.disconnected ? "disconnected" : source.behind ? "behind" : "loaded";
const spans = (ranges: Range[]): string => ranges.map((r) => `${r.from}..${r.to - 1}`).join(", ") || "none";
const cachedRows = (ranges: Range[]): number => ranges.reduce((n, r) => n + (r.to - r.from), 0);

export class ShuClientCacheColumn extends ShuElement<typeof EmptySchema> {
	#unsubscribes = new Map<RunSource, () => void>();
	#held: THeldExecution[] = [];
	#registry: TStoredRegistry | undefined; // the site's registry as the device holds it, for when it was cached
	#databases: TIdbDatabaseSummary[] = [];
	#reading = false;
	#readAgain = false;
	#deviceRead = false; // the device has been read at least once: before that, what it caches is not known, not absent
	#readDue: ReturnType<typeof setTimeout> | undefined;
	#liveByLevel = new Map<string, { count: number; newest?: number }>(); // what the live stream delivered since this view opened
	#openedAt = 0; // the device's time when this view opened: what "since this view opened" is measured from
	#forgets = 0; // how many runs a reader has forgotten here: a device read begun before a forget cannot know the run went
	#forgotten: { execution: string; records: number } | undefined; // what the last forget removed

	static styles = [
		shuBaseStyles,
		css`
			:host {
				display: block;
				overflow: auto;
				font-size: var(--shu-font-md);
				padding: var(--shu-space-3);
			}
			h4 {
				margin: var(--shu-space-3) 0 var(--shu-space-2);
				font-size: var(--shu-font-md);
			}
			table {
				border-collapse: collapse;
				width: 100%;
				font-family: var(--shu-font-mono, monospace);
				font-size: var(--shu-font-sm);
			}
			th,
			td {
				text-align: left;
				padding: 2px var(--shu-space-2);
				border-bottom: var(--shu-border-w) solid var(--shu-border);
				vertical-align: top;
				white-space: nowrap;
			}
			th {
				color: var(--shu-fg-muted);
				font-weight: 600;
			}
			.empty {
				color: var(--shu-fg-faded);
				padding: var(--shu-space-2);
			}
			.note {
				color: var(--shu-fg-muted);
				font-size: var(--shu-font-sm);
				padding: 0 var(--shu-space-2) var(--shu-space-2);
			}
			/* A value a reader can act on reads as the value, not as a control: the action is the value itself. */
			button.link {
				font: inherit;
				color: var(--shu-accent);
				background: none;
				border: none;
				padding: 0;
				cursor: pointer;
				text-align: left;
			}
			button.link:hover {
				text-decoration: underline;
			}
			tr.reading {
				background: var(--shu-bg-elevated);
			}
		`,
	];

	constructor() {
		super(EmptySchema, {});
	}

	summarizeForKihan(): TLinkedData | null {
		return {
			"@id": "view:client-cache",
			"@type": "as:Note",
			name: "what this page caches of the run",
			cursor: this.timeCursor,
			registry: registryOrigin(),
			sources: runSources().map((s) => ({ level: s.level, ...s.extent(), cached: spans(s.cachedRanges()), cursorRow: this.#cursorRowIn(s) })),
			openedAt: this.#openedAt,
			live: Object.fromEntries(this.#liveByLevel),
			executions: this.#held,
			forgotten: this.#forgotten ?? null,
			indexedDb: this.#databases,
		};
	}

	protected override onConnected(): void {
		this.#openedAt = Date.now();
		this.#watchSources();
		void this.#readDevice(); // the device at once on open; after changes, at the bounded cadence
		// A source made from now on (a view opened at another level) is watched from the moment it exists.
		this.autoTeardown(subscribeRunSources(() => this.#changed()));
		// A run the reader chose, or a new one the server began: both change what every view reads.
		this.autoTeardown(subscribeExecutionSwitch(() => this.#changed()));
		// The sources persist what they read after they report it, so what the device caches is read again when it is written.
		this.autoTeardown(subscribeDeviceWrites(() => this.#changed()));
		// Every live batch: counted by level and shown, whether or not any source takes it (a page with no event view open takes none).
		this.autoTeardown(
			subscribeBatchedEvents({
				onBatch: (events) => {
					for (const e of events as Array<Record<string, unknown>>) {
						const level = String(e.level ?? "info");
						const seen = this.#liveByLevel.get(level) ?? { count: 0 };
						const t = Number(e.timestamp);
						this.#liveByLevel.set(level, { count: seen.count + 1, newest: Number.isFinite(t) ? Math.max(seen.newest ?? 0, t) : seen.newest });
					}
					this.#changed();
				},
			}),
		);
		this.autoTeardown(() => {
			for (const off of this.#unsubscribes.values()) off();
			this.#unsubscribes.clear();
			if (this.#readDue) clearTimeout(this.#readDue);
		});
	}

	/** The cursor moved: where it sits in each source is derived in render. */
	protected override onTimeSync(): void {
		this.requestUpdate();
	}

	/** Something moved: what is in memory shows at once; the device is read again soon, once for however many changes. */
	#changed(): void {
		this.#watchSources();
		this.requestUpdate();
		if (this.#readDue) return;
		this.#readDue = setTimeout(() => {
			this.#readDue = undefined;
			void this.#readDevice();
		}, DEVICE_READ_DELAY_MS);
	}

	/** Every source built so far is watched for its changes (a page landing, the extent growing, a new run). */
	#watchSources(): void {
		for (const src of runSources()) {
			if (this.#unsubscribes.has(src)) continue;
			this.#unsubscribes.set(
				src,
				src.subscribe(() => this.#changed()),
			);
		}
	}

	async #readDevice(): Promise<void> {
		if (this.#reading) {
			this.#readAgain = true; // a read is under way: what changed since is read as soon as it finishes
			return;
		}
		this.#reading = true;
		const began = this.#forgets;
		try {
			const [held, databases, registry] = await Promise.all([executionsHeld(), indexedDbSummary(), deviceStore().registry()]);
			// A run forgotten while this read was running is still in what it read, so the read made after the forget stands.
			if (began === this.#forgets) {
				this.#held = held;
				this.#databases = databases;
				this.#registry = registry;
				this.#deviceRead = true;
			}
		} finally {
			this.#reading = false;
		}
		this.requestUpdate();
		if (this.#readAgain) {
			this.#readAgain = false;
			void this.#readDevice();
		}
	}

	/** Forget one run this device holds, and report what went. The run being read has no control for it: a reader reads
	 *  another run first, so nothing is deleted under a view drawing it. The executions are read again here rather than on
	 *  the ordinary cadence, so the list a reader sees after the deletion is the list the device holds. */
	async #forget(execution: string): Promise<void> {
		const records = await forgetExecution(execution);
		this.#forgets += 1;
		this.#held = await executionsHeld();
		this.#forgotten = { execution, records };
		this.requestUpdate();
	}

	/** The row the cursor sits on in a source, among the rows it caches: -1 for none (the live edge, or before the first cached). */
	#cursorRowIn(src: RunSource): number {
		const cursor = this.timeCursor;
		if (cursor === null) return -1;
		const rows: Array<{ index: number; timestamp: number }> = [];
		for (const { from, to } of src.cachedRanges()) for (let i = from; i < to; i++) rows.push({ index: i, timestamp: Number(src.rowAt(i)?.timestamp) || 0 });
		return currentRowIndex(rows, cursor);
	}

	/** Put the shared cursor at an instant this view reports, so every open view scrubs to the moment a reader clicked. */
	#cursorTo(instant: number | undefined): void {
		if (instant === undefined || !Number.isFinite(instant)) return;
		this.timeCursor = atLiveEdge(instant) ? null : instant;
	}

	/** An instant a reader can act on: clicking it moves the shared cursor there. */
	#instant(id: string, value: number | undefined): TemplateResult {
		const shown = at(value);
		return shown === ""
			? html`<td data-testid=${id}></td>`
			: html`<td data-testid=${id}><button class="link" title="scrub every view to this moment" @click=${() => this.#cursorTo(value)}>${shown}</button></td>`;
	}

	/** The spans a source caches, each one a control: clicking a span scrubs to the first row it caches. */
	#spans(source: RunSource, id: string): TemplateResult {
		const ranges = source.cachedRanges();
		if (ranges.length === 0) return html`<td data-testid=${id}>none</td>`;
		return html`<td data-testid=${id}>
			${ranges.map(
				(r, i) =>
					html`${i > 0 ? ", " : ""}<button class="link" title="scrub to the first row this span caches" @click=${() => this.#cursorTo(Number(source.rowAt(r.from)?.timestamp) || undefined)}>
							${r.from}..${r.to - 1}
						</button>`,
			)}
		</td>`;
	}

	render(): TemplateResult {
		const sources = runSources();
		const cursor = this.timeCursor;
		// The moment every source reads around, which is the cursor once a reader has moved it: what is read is what a
		// reader is looking at, and this says so rather than leaving it to be inferred from the rows.
		const readingMoment = runReadingAt();
		// The execution being read: the one a reader chose, else the newest this device holds, which is the one being
		// recorded while a site is recording one.
		const reading = currentExecution() ?? this.#held[0]?.execution;
		const earlier = this.#held.find((e) => e.execution !== reading)?.execution;
		const registry = registryOrigin();
		const respondedAt = serverLastRespondedAt();
		const cached = this.#registry;
		// What the execution being read ran, from the run being read rather than from what the device has been asked for:
		// a page names what it is reading as soon as it has read it.
		const named = (execution: string | undefined): string => this.#held.find((e) => e.execution === execution)?.features.join(", ") || featureBeingRead(sources) || execution || "";
		const cell = (id: string, value: unknown): TemplateResult => html`<td data-testid=${id}>${value}</td>`;
		return html`<div data-testid=${IDS.ROOT}>
			<h4>Registry</h4>
			<div data-testid=${IDS.REGISTRY}>
				${registry === null ? "not known yet" : registry.from === "server" ? `from the server${cached ? `, cached on the device at ${at(cached.savedAt)}` : ""}` : `from the device, cached at ${at(registry.savedAt)} (the server did not respond)`}
			</div>
			<h4>Server</h4>
			<div data-testid=${IDS.SERVER}>${respondedAt === undefined ? "has not responded to this page" : `last responded at ${at(respondedAt)}`}</div>
			<h4>Cursor</h4>
			<div data-testid=${IDS.CURSOR}>
				${cursor === null ? "live edge" : html`${at(cursor)} <button class="link" title="back to the live edge" @click=${() => (this.timeCursor = null)}>to the live edge</button>`}
			</div>
			<div data-testid=${IDS.READING_AT}>${readingMoment === undefined ? "following the newest records" : `the run is read around ${at(readingMoment)}`}</div>
			<h4>Live stream since this view opened (device time ${at(this.#openedAt)})</h4>
			${
				this.#liveByLevel.size === 0
					? html`<div class="empty">No event has arrived since this view opened.</div>`
					: html`<table>
							<tr>
								<th>level</th>
								<th>events</th>
								<th>newest</th>
							</tr>
							${HAIBUN_LOG_LEVELS.filter((l) => this.#liveByLevel.has(l)).map((l) => {
								const seen = this.#liveByLevel.get(l) as { count: number; newest?: number };
								return html`<tr>
								<td>${l}</td>
								${cell(`${IDS.LIVE}${l}`, seen.count)}${this.#instant(`${IDS.LIVE}${l}-newest`, seen.newest)}
							</tr>`;
							})}
						</table>`
			}
			<h4>Run sources</h4>
			${
				sources.length === 0
					? html`<div class="empty">No view has read the run yet.</div>`
					: html`<table>
							<tr>
								<th>level</th>
								<th>events</th>
								<th>first</th>
								<th>newest</th>
								<th>page</th>
								<th>cached</th>
								<th>cached rows</th>
								<th>cursor row</th>
								<th>state</th>
							</tr>
							${sources.map((s) => {
								const e = s.extent();
								const cached = s.cachedRanges();
								const row = this.#cursorRowIn(s);
								const id = (field: string): string => `${IDS.SOURCE}${s.level}-${field}`;
								return html`<tr>
								<td>${s.level}</td>
								${cell(id("events"), e.total)}${this.#instant(id("first"), e.first)}${this.#instant(id("newest"), e.last)}${cell(id("page"), s.pageSize)}
								${this.#spans(s, id("cached"))}${cell(id("cached-rows"), cachedRows(cached))}${cell(id("cursor"), row < 0 ? "" : row)}${cell(id(stateOf(s)), s.unavailable ?? stateOf(s))}
							</tr>`;
							})}
						</table>`
			}
			<h4>Executions this device holds <small>(named by the features each ran, from the newest ${EXECUTIONS_READ} feature declarations held)</small></h4>
			<div>
				reading
				<span data-testid=${IDS.READING}>${named(reading) || "no execution yet"}</span>
				${earlier === undefined ? "" : html` <button data-testid=${IDS.READ_EARLIER} @click=${() => readExecution(earlier)}>read the execution before it</button>`}
			</div>
			${
				this.#held.length === 0
					? emptyOrLoading(this.#deviceRead, "No execution is held on this device.")
					: html`<table data-testid=${IDS.HELD}>
							<tr>
								<th>execution</th>
								<th>features</th>
								<th>reading</th>
								<th>began</th>
								<th>newest</th>
								<th>forget</th>
							</tr>
							${this.#held.map((e) => {
								const id = (field: string): string => `${IDS.RUN}${e.execution}-${field}`;
								return html`<tr data-testid=${`${IDS.RUN}${e.execution}`} class=${e.execution === reading ? "reading" : ""}>
								<td>
									${e.execution === reading ? e.execution : html`<button class="link" data-testid=${id("read")} title="read this execution" @click=${() => readExecution(e.execution)}>${e.execution}</button>`}
								</td>
								${cell(id("features"), e.features.join(", "))}${cell(id("reading"), e.execution === reading ? "reading" : "")}
								${this.#instant(id("began"), e.first)}${this.#instant(id("newest"), e.last)}
								<td>
									${e.execution === reading ? "" : html`<button class="link" data-testid=${id("forget")} title="forget this run on this device" @click=${() => void this.#forget(e.execution)}>forget</button>`}
								</td>
							</tr>`;
							})}
						</table>`
			}
			${this.#forgotten === undefined ? "" : html`<div data-testid=${IDS.FORGOTTEN}>the run ${this.#forgotten.execution} and its ${this.#forgotten.records} records are forgotten</div>`}
			<h4>IndexedDB <small>(this build reads ${CACHE_SHAPE}; a cache written to another rule is forgotten on open)</small></h4>
			${
				this.#databases.length === 0
					? emptyOrLoading(this.#deviceRead, "No IndexedDB database on this origin.")
					: html`<table>
							<tr>
								<th>database</th>
								<th>version</th>
								<th>store</th>
								<th>records</th>
							</tr>
							${this.#databases.flatMap((d) =>
								d.stores.map(
									(s) =>
										html`<tr>
										<td>${d.name}</td>
										<td>${d.version}</td>
										<td>${s.name}</td>
										${cell(`${IDS.IDB}${d.name}-${s.name}`, s.count)}
									</tr>`,
								),
							)}
						</table>`
			}
		</div>`;
	}
}
