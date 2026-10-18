/**
 * <shu-client-cache-column>: what this page caches of actuality, as it stands: each actuality source (one per level read) with
 * its extent, the index spans it caches and the shared cursor's row in it; what the live stream has delivered since the
 * view opened, by level; the actualities the device holds; every IndexedDB database of the origin with its stores and
 * their counts; and how full each database's graph is. It doesn't request data from the server: a source is listed once
 * a view has read its level, and the store is read as it is. A reader makes one change here, which is to delete an actuality
 * this device holds. It follows everything that moves: each source as it is made and as it changes, every live batch,
 * the cursor, and shows the change at once; the device is read again after changes at a bounded cadence, since reading
 * it is slower than the stream. Every value carries its own test id (SHU_TEST_IDS.CLIENT_CACHE), so this one view is the
 * source of a feature's cache facts. It also reports the origin of the server's registry the page runs on: the server,
 * or the device's copy when the server did not respond.
 */
import { SHU_TAG } from "../../../domains/elements.js";
import { defineElement } from "../../controllers/element-controller.js";
import { html, css, type TemplateResult } from "lit";
import { ShuElement, type TLinkedData, EmptyStateSchema } from "../../components/shu-element.js";
import { shuBaseStyles } from "../../components/styles.js";
import { SHU_TEST_IDS } from "../../../domains/test-ids.js";
import { subscribeBatchedEvents } from "../../controllers/event-stream-controller.js";
import { rowAtCursor, timedRows, type Range } from "../../derivations/rail.js";
import { EventLevelSchema, HAIBUN_LOG_LEVELS } from "@haibun/core/lib/domains/protocol.js";
import { registryOrigin } from "../../controllers/registry-controller.js";
import { serverLastRespondedAt } from "../../controllers/conduit-controller.js";
import { emptyOrLoading } from "../../components/empty-state.js";
import { atLiveEdge, actualityReadingAt, actualitySources, subscribeActualitySources, type ActualitySource } from "../controllers/actuality-controller.js";
import { actualityOf } from "@haibun/core/lib/seq-path.js";
import { actualitiesHeld, deleteActuality, FEATURES_READ, readHeldActuality, type THeldActuality } from "../controllers/held-actualities-controller.js";
import {
	CACHE_SHAPE,
	currentExecution,
	deviceSummary,
	followDeviceWrites,
	graphSaturations,
	pageDeviceStore,
	subscribeExecutionSwitch,
	type TGraphSaturation,
	type TIdbDatabaseSummary,
	type TStoredRegistry,
} from "../controllers/device-controller.js";
import { renderedAt } from "../derivations/rendered-rows.js";
import { ClockController } from "../../controllers/clock-controller.js";
import { TimelineViewController } from "../../controllers/timeline-view-controller.js";

/** The name of the delay before the column reads the device again. */
const DEVICE_READ = "device-read";

const IDS = SHU_TEST_IDS.CLIENT_CACHE;
/** How soon after a change the device is read again: the stream can change many times a second, the device once in this.
 *  Short enough that what the device caches is reported as it happens, long enough that a burst is one read. */
const DEVICE_READ_DELAY_MS = 150;

const at = (t: number | undefined): string => (t === undefined || !Number.isFinite(t) ? "" : new Date(t).toISOString().slice(11, 23));
/** The feature the execution being read declared, from its first rows a view has read. An execution declares its feature at
 *  its start, so this reads the first rows rather than actuality. */
function featureBeingRead(sources: ActualitySource[]): string {
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

/** How far into an execution its feature declaration is looked for: an execution declares it at its start. */
const FEATURE_WITHIN_ROWS = 20;

/** What a source is doing, one word a reader waits for: not yet read, cut off from actuality, behind what actuality has
 *  announced, or read and current. Each is a fact of the reading, so a state isn't inferred from what happens to arrive. */
const stateOf = (source: ActualitySource): string =>
	source.unavailable ? "unavailable" : source.ended ? "ended" : !source.loaded ? "loading" : source.disconnected ? "disconnected" : source.behind ? "behind" : "loaded";
const spans = (ranges: Range[]): string => (ranges.length === 0 ? "none" : ranges.map((r) => `${r.from}..${r.to - 1}`).join(", "));
const cachedRows = (ranges: Range[]): number => ranges.reduce((n, r) => n + (r.to - r.from), 0);

export class ShuClientCacheColumn extends ShuElement<typeof EmptyStateSchema> {
	/** The instant this view shows, which is the page's time cursor or the moment `data-snapshot-time` states. */
	readonly #timeline = new TimelineViewController(this);
	#unsubscribes = new Map<ActualitySource, () => void>();
	#held: THeldActuality[] = [];
	#registry: TStoredRegistry | undefined; // the site's registry as the device holds it, for when it was cached
	#databases: TIdbDatabaseSummary[] = [];
	#graphs: Array<{ database: string; saturation: TGraphSaturation }> = [];
	#reading = false;
	#readAgain = false;
	#deviceRead = false; // the device has been read at least once: before that, what it caches is pending, not absent
	readonly #clock = new ClockController(this);
	#liveByLevel = new Map<string, { count: number; newest?: number }>(); // what the live stream delivered since this view opened
	#openedAt = 0; // the device's time when this view opened: what "since this view opened" is measured from
	#deletions = 0; // how many actualities a reader has deleted here: a device read begun before a deletion still lists that actuality
	#deleted: { actuality: string; records: number } | undefined; // what the last deletion removed

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
		super(EmptyStateSchema);
	}

	summarizeForContext(): TLinkedData | null {
		return {
			"@id": "view:client-cache",
			"@type": "as:Note",
			name: "what this page caches of actuality",
			cursor: this.#timeline.cursor,
			registry: registryOrigin(),
			sources: actualitySources().map((s) => ({ level: s.level, ...s.extent(), cached: spans(s.cachedRanges()), cursorRow: this.#cursorRowIn(s) })),
			openedAt: this.#openedAt,
			live: Object.fromEntries(this.#liveByLevel),
			actualities: this.#held,
			deleted: this.#deleted === undefined ? null : this.#deleted,
			indexedDb: this.#databases,
		};
	}

	protected override onConnected(): void {
		this.#openedAt = Date.now();
		this.#watchSources();
		void this.#readDevice(); // the device at once on open; after changes, at the bounded cadence
		// A source made from now on (a view opened at another level) is watched from the moment it exists.
		this.autoTeardown(subscribeActualitySources(() => this.#changed()));
		// An execution the reader chose, or a new one the server began: both change what every view reads.
		this.autoTeardown(subscribeExecutionSwitch(() => this.#changed()));
		// The sources persist what they read after they report it, so what the device caches is read again when it is written.
		this.autoTeardown(followDeviceWrites(() => this.#changed()));
		// Every live batch: counted by level and shown, whether or not any source takes it (a page without an open event view doesn't take a batch).
		this.autoTeardown(
			subscribeBatchedEvents({
				onBatch: (events) => {
					for (const e of events as Array<Record<string, unknown>>) {
						const { level } = EventLevelSchema.parse(e);
						const seen = this.#liveByLevel.get(level);
						const t = Number(e.timestamp);
						const newest = !Number.isFinite(t) ? seen?.newest : seen?.newest === undefined ? t : Math.max(seen.newest, t);
						this.#liveByLevel.set(level, { count: seen === undefined ? 1 : seen.count + 1, ...(newest === undefined ? {} : { newest }) });
					}
					this.#changed();
				},
			}),
		);
		this.autoTeardown(() => {
			for (const off of this.#unsubscribes.values()) off();
			this.#unsubscribes.clear();
		});
	}

	/** Something moved: what is in memory shows at once; the device is read again soon, once for however many changes. */
	#changed(): void {
		this.#watchSources();
		this.requestUpdate();
		this.#clock.coalesce(DEVICE_READ, DEVICE_READ_DELAY_MS, () => void this.#readDevice());
	}

	/** Every source built so far is watched for its changes (a page landing, the extent growing, a new actuality). */
	#watchSources(): void {
		for (const src of actualitySources()) {
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
		const began = this.#deletions;
		try {
			const [held, databases, registry, graphs] = await Promise.all([actualitiesHeld(), deviceSummary(), pageDeviceStore().registry(), graphSaturations()]);
			// An actuality deleted while this read was running is still in what it read, so the read made after the deletion stands.
			if (began === this.#deletions) {
				this.#held = held;
				this.#databases = databases;
				this.#registry = registry;
				this.#graphs = graphs;
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

	/** Delete one actuality this device holds, and report what went. The actuality being read doesn't have a control for it:
	 *  a reader reads another actuality first, so an actuality isn't deleted under a view drawing it. The actualities are
	 *  read again here rather than on the ordinary cadence, so the list a reader sees after the deletion is the list the
	 *  device holds. */
	async #delete(held: THeldActuality): Promise<void> {
		const records = await deleteActuality(held);
		this.#deletions += 1;
		this.#held = await actualitiesHeld();
		this.#deleted = { actuality: held.actuality, records };
		this.requestUpdate();
	}

	/** The cursor's row in a source, among the rows it caches: -1 where the cursor isn't on a cached row (the live edge, or before the first cached). */
	#cursorRowIn(src: ActualitySource): number {
		const cursor = this.#timeline.cursor;
		if (cursor === null) return -1;
		const rows: Array<{ index: number; timestamp: number }> = [];
		for (const { from, to } of src.cachedRanges())
			for (let i = from; i < to; i++) {
				const event = src.rowAt(i);
				if (event) rows.push({ index: i, timestamp: renderedAt(event) });
			}
		return rowAtCursor(timedRows(rows), cursor);
	}

	/** Put the shared cursor at an instant this view reports, so every open view scrubs to the moment a reader clicked. */
	#cursorTo(instant: number | undefined): void {
		if (instant === undefined || !Number.isFinite(instant)) return;
		this.#timeline.movePage(atLiveEdge(instant) ? null : instant);
	}

	/** An instant a reader can act on: clicking it moves the shared cursor there. */
	#instant(id: string, value: number | undefined): TemplateResult {
		const shown = at(value);
		return shown === ""
			? html`<td data-testid=${id}></td>`
			: html`<td data-testid=${id}><button class="link" title="scrub every view to this moment" @click=${() => this.#cursorTo(value)}>${shown}</button></td>`;
	}

	/** The spans a source caches, each one a control: clicking a span scrubs to the first row it caches. */
	#spans(source: ActualitySource, id: string): TemplateResult {
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
		const sources = actualitySources();
		const cursor = this.#timeline.cursor;
		// The moment every source reads around, which is the cursor once a reader has moved it: what is read is what a
		// reader is looking at, and this shows it rather than leaving it to be inferred from the rows.
		const readingMoment = actualityReadingAt();
		// The actuality being read: the one of the execution a reader chose, else the newest this device holds, which is the
		// one being recorded while a site is recording one.
		const chosen = currentExecution();
		const reading = chosen === undefined ? this.#held[0]?.actuality : actualityOf(chosen);
		const earlier = this.#held.find((a) => a.actuality !== reading);
		const registry = registryOrigin();
		const respondedAt = serverLastRespondedAt();
		const cached = this.#registry;
		// What the actuality being read ran, from the device's list, else from the rows read: a page names what it is reading
		// as soon as it has read it.
		const named = (actuality: string | undefined): string => {
			const held = this.#held.find((a) => a.actuality === actuality);
			if (held !== undefined && held.features.length > 0) return held.features.join(", ");
			const declared = featureBeingRead(sources);
			if (declared !== "") return declared;
			return actuality === undefined ? "" : actuality;
		};
		const cell = (id: string, value: unknown): TemplateResult => html`<td data-testid=${id}>${value}</td>`;
		return html`<div data-testid=${IDS.ROOT}>
			<h4>Registry</h4>
			<div data-testid=${IDS.REGISTRY}>
				${registry === undefined ? "pending" : registry.from === "site" ? `from the server${cached ? `, cached on the device at ${at(cached.savedAt)}` : ""}` : `from the device, cached at ${at(registry.savedAt)} (the server did not respond)`}
			</div>
			<h4>Server</h4>
			<div data-testid=${IDS.SERVER}>${respondedAt === undefined ? "has not responded to this page" : `last responded at ${at(respondedAt)}`}</div>
			<h4>Cursor</h4>
			<div data-testid=${IDS.CURSOR}>
				${cursor === null ? "live edge" : html`${at(cursor)} <button class="link" title="back to the live edge" @click=${() => this.#timeline.movePage(null)}>to the live edge</button>`}
			</div>
			<div data-testid=${IDS.READING_AT}>${readingMoment === undefined ? "following the newest records" : `actuality is read around ${at(readingMoment)}`}</div>
			<h4>Live stream since this view opened (device time ${at(this.#openedAt)})</h4>
			${
				this.#liveByLevel.size === 0
					? html`<div class="empty">An event hasn't arrived since this view opened.</div>`
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
			<h4>Actuality sources</h4>
			${
				sources.length === 0
					? html`<div class="empty">A view hasn't read actuality yet.</div>`
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
			<h4>Actualities this device holds <small>(by their features, from the newest ${FEATURES_READ} declared)</small></h4>
			<div>
				reading
				<span data-testid=${IDS.READING}>${named(reading) === "" ? "not reading an actuality yet" : named(reading)}</span>
				${earlier === undefined ? "" : html` <button data-testid=${IDS.READ_EARLIER} @click=${() => readHeldActuality(earlier)}>read the one before it</button>`}
			</div>
			${
				this.#held.length === 0
					? emptyOrLoading(this.#deviceRead, "This device doesn't hold an actuality.")
					: html`<table data-testid=${IDS.HELD}>
							<tr>
								<th>actuality</th>
								<th>features</th>
								<th>reading</th>
								<th>began</th>
								<th>newest</th>
								<th>delete</th>
							</tr>
							${this.#held.map((a) => {
								const id = (field: string): string => `${IDS.ACTUALITY}${a.actuality}-${field}`;
								return html`<tr data-testid=${`${IDS.ACTUALITY}${a.actuality}`} class=${a.actuality === reading ? "reading" : ""}>
								<td>
									${a.actuality === reading ? a.actuality : html`<button class="link" data-testid=${id("read")} title="read it" @click=${() => readHeldActuality(a)}>${a.actuality}</button>`}
								</td>
								${cell(id("features"), a.features.join(", "))}${cell(id("reading"), a.actuality === reading ? "reading" : "")}
								${this.#instant(id("began"), a.first)}${this.#instant(id("newest"), a.last)}
								<td>
									${a.actuality === reading ? "" : html`<button class="link" data-testid=${id("delete")} title="delete on this device" @click=${() => void this.#delete(a)}>delete</button>`}
								</td>
							</tr>`;
							})}
						</table>`
			}
			${this.#deleted === undefined ? "" : html`<div data-testid=${IDS.DELETED}>actuality ${this.#deleted.actuality} and its ${this.#deleted.records} records are deleted</div>`}
			<h4>IndexedDB <small>(this build reads ${CACHE_SHAPE}; a cache written to another rule is cleared on open)</small></h4>
			${
				this.#databases.length === 0
					? emptyOrLoading(this.#deviceRead, "This origin doesn't hold an IndexedDB database.")
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
			<h4>Graph <small>(each database holds its graph within a bound, and drops its oldest quads past it)</small></h4>
			${
				this.#graphs.length === 0
					? emptyOrLoading(this.#deviceRead, "This device doesn't hold a graph.")
					: html`<table>
							<tr>
								<th>database</th>
								<th>quads</th>
								<th>bound</th>
								<th>dropped</th>
							</tr>
							${this.#graphs.map(
								({ database, saturation }) =>
									html`<tr>
									<td>${database}</td>
									${cell(`${IDS.GRAPH}${database}-held`, saturation.held)}${cell(`${IDS.GRAPH}${database}-bound`, saturation.bound)}${cell(`${IDS.GRAPH}${database}-dropped`, saturation.dropped)}
								</tr>`,
							)}
						</table>`
			}
		</div>`;
	}
}

defineElement(SHU_TAG.CLIENT_CACHE_COLUMN, ShuClientCacheColumn);
