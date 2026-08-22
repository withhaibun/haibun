/**
 * <shu-client-cache-column> — what this page holds of the run, as it stands: each run source (one per level read) with
 * its extent, the index spans it holds resident and the row the shared cursor sits on in it; what the live stream has
 * brought since the view opened, by level; what the device's event store keeps of the last run, by level; and every
 * IndexedDB database of the origin with its stores and their counts. It makes nothing: a source is listed once a view has
 * read its level, the store is read as it is, and nothing is asked of the server. It watches everything that moves —
 * each source as it is made and as it changes, every live batch, the cursor — and shows the change at once; the device
 * is re-read after changes at a bounded cadence, since reading it is slower than the stream. Every value carries its own
 * test id (SHU_TEST_IDS.CLIENT_CACHE), so this one view is what a feature reads cache facts from.
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
import { runSources, runSourceStore, subscribeRunSources, type RunSource, type TEventStoreSummary, indexedDbSummary, type TIdbDatabaseSummary } from "../client-cache/index.js";

const EmptySchema = z.object({});
const IDS = SHU_TEST_IDS.CLIENT_CACHE;
/** How soon after a change the device is read again: the stream can change many times a second, the device once in this. */
export const DEVICE_READ_DELAY_MS = 500;

const at = (t: number | undefined): string => (t === undefined || !Number.isFinite(t) ? "" : new Date(t).toISOString().slice(11, 23));
const spans = (ranges: Range[]): string => ranges.map((r) => `${r.from}..${r.to - 1}`).join(", ") || "none";
const held = (ranges: Range[]): number => ranges.reduce((n, r) => n + (r.to - r.from), 0);

export class ShuClientCacheColumn extends ShuElement<typeof EmptySchema> {
	#unsubscribes = new Map<RunSource, () => void>();
	#store: TEventStoreSummary = { runs: [] };
	#databases: TIdbDatabaseSummary[] = [];
	#reading = false;
	#readDue: ReturnType<typeof setTimeout> | undefined;
	#liveByLevel = new Map<string, { count: number; newest?: number }>(); // what the live stream brought since this view opened

	static styles = [
		shuBaseStyles,
		css`
			:host { display: block; overflow: auto; font-size: var(--shu-font-md); padding: var(--shu-space-3); }
			h4 { margin: var(--shu-space-3) 0 var(--shu-space-2); font-size: var(--shu-font-md); }
			table { border-collapse: collapse; width: 100%; font-family: var(--shu-font-mono, monospace); font-size: var(--shu-font-sm); }
			th, td { text-align: left; padding: 2px var(--shu-space-2); border-bottom: var(--shu-border-w) solid var(--shu-border); vertical-align: top; white-space: nowrap; }
			th { color: var(--shu-fg-muted); font-weight: 600; }
			.empty { color: var(--shu-fg-faded); padding: var(--shu-space-2); }
		`,
	];

	constructor() {
		super(EmptySchema, {});
	}

	summarizeForKihan(): TLinkedData | null {
		return {
			"@id": "view:client-cache",
			"@type": "as:Note",
			name: "what this page holds of the run",
			cursor: this.timeCursor,
			sources: runSources().map((s) => ({ level: s.level, ...s.extent(), resident: spans(s.residentRanges()), cursorRow: this.#cursorRowIn(s) })),
			live: Object.fromEntries(this.#liveByLevel),
			store: this.#store,
			indexedDb: this.#databases,
		};
	}

	protected override onConnected(): void {
		this.#changed();
		// A source made from now on (a view opened at another level) is watched from the moment it exists.
		this.autoTeardown(subscribeRunSources(() => this.#changed()));
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
		if (this.#reading) return; // a read under way: the one due after it reads what this one would have
		this.#reading = true;
		try {
			const [store, databases] = await Promise.all([runSourceStore().summary(), indexedDbSummary()]);
			this.#store = store;
			this.#databases = databases;
		} finally {
			this.#reading = false;
		}
		this.requestUpdate();
	}

	/** The row the cursor sits on in a source, among the rows it holds: -1 for none (the live edge, or before the first held). */
	#cursorRowIn(src: RunSource): number {
		const cursor = this.timeCursor;
		if (cursor === null) return -1;
		const rows: Array<{ index: number; timestamp: number }> = [];
		for (const { from, to } of src.residentRanges()) for (let i = from; i < to; i++) rows.push({ index: i, timestamp: Number(src.rowAt(i)?.timestamp) || 0 });
		return currentRowIndex(rows, cursor);
	}

	render(): TemplateResult {
		const sources = runSources();
		const cursor = this.timeCursor;
		const lastRun = this.#store.lastRun;
		const stored = lastRun === undefined ? undefined : this.#store.runs.find((r) => r.run === lastRun);
		const cell = (id: string, value: unknown): TemplateResult => html`<td data-testid=${id}>${value}</td>`;
		return html`<div data-testid=${IDS.ROOT}>
			<h4>Cursor</h4>
			<div data-testid=${IDS.CURSOR}>${cursor === null ? "live edge" : at(cursor)}</div>
			<h4>Live stream since this view opened</h4>
			${
				this.#liveByLevel.size === 0
					? html`<div class="empty">No events yet.</div>`
					: html`<table>
						<tr><th>level</th><th>events</th><th>newest</th></tr>
						${HAIBUN_LOG_LEVELS.filter((l) => this.#liveByLevel.has(l)).map((l) => {
							const seen = this.#liveByLevel.get(l) as { count: number; newest?: number };
							return html`<tr><td>${l}</td>${cell(`${IDS.LIVE}${l}`, seen.count)}<td>${at(seen.newest)}</td></tr>`;
						})}
					</table>`
			}
			<h4>Run sources</h4>
			${
				sources.length === 0
					? html`<div class="empty">No view has read the run yet.</div>`
					: html`<table>
						<tr><th>level</th><th>events</th><th>first</th><th>newest</th><th>page</th><th>resident</th><th>held</th><th>cursor row</th><th>state</th></tr>
						${sources.map((s) => {
							const e = s.extent();
							const resident = s.residentRanges();
							const row = this.#cursorRowIn(s);
							const id = (field: string): string => `${IDS.SOURCE}${s.level}-${field}`;
							return html`<tr>
								<td>${s.level}</td>${cell(id("events"), e.total)}${cell(id("first"), at(e.first))}${cell(id("newest"), at(e.last))}${cell(id("page"), s.pageSize)}
								${cell(id("resident"), spans(resident))}${cell(id("held"), held(resident))}${cell(id("cursor"), row < 0 ? "" : row)}${cell(id("state"), s.unavailable ?? (s.loaded ? "loaded" : "loading"))}
							</tr>`;
						})}
					</table>`
			}
			<h4>Device store${lastRun !== undefined ? html` <small>(last run ${lastRun || "unnamed"})</small>` : ""}</h4>
			${
				!stored || stored.levels.length === 0
					? html`<div class="empty">Nothing of the last run stored on this device.</div>`
					: html`<table>
						<tr><th>level</th><th>stored</th><th>extent</th><th>first</th><th>newest</th></tr>
						${stored.levels.map(
							(l) => html`<tr><td>${l.level}</td>${cell(`${IDS.STORE}${l.level}-stored`, l.stored)}${cell(`${IDS.STORE}${l.level}-extent`, l.extent?.total ?? "")}<td>${at(l.extent?.first)}</td><td>${at(l.extent?.last)}</td></tr>`,
						)}
					</table>`
			}
			<h4>IndexedDB</h4>
			${
				this.#databases.length === 0
					? html`<div class="empty">No IndexedDB databases, or none listable here.</div>`
					: html`<table>
						<tr><th>database</th><th>version</th><th>store</th><th>records</th></tr>
						${this.#databases.flatMap((d) => d.stores.map((s) => html`<tr><td>${d.name}</td><td>${d.version}</td><td>${s.name}</td>${cell(`${IDS.IDB}${d.name}-${s.name}`, s.count)}</tr>`))}
					</table>`
			}
		</div>`;
	}
}
