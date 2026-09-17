/**
 * <shu-page-strip>: the strip along the bottom of the page, whatever is docked above it and wherever the actions bar
 * stands. It holds the control that opens and closes the docked pane and its pin, the page's status, the breadcrumb of
 * the columns, and the corner controls: the read access level, the run's time and playback, and the settings.
 */
import { html, type CSSResultGroup, type TemplateResult } from "lit";
import { z } from "zod";
import type { AccessQueryLevel } from "@haibun/core/lib/resources.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { PageStripCorners } from "./page-strip-corners.js";
import { FootprintController } from "./footprint.js";
import { loadSlotExtensions } from "./slot-extensions.js";
import { SignalController } from "../controllers/signal-controller.js";
import { activePane, dockedPane, pageContext, pageStatus, pageTrail, pageTypes, stripPanes } from "../signals.js";
import { PAGE_STRIP_FOOTPRINT, PERMISSIONS_SLOT, SEARCH_SLOT, SHU_ATTR, SHU_EVENT, SHU_TAG } from "../consts.js";
import { isOffline } from "../rpc-registry.js";
import { reportToRun } from "../client-log.js";
import { appAccessLevel } from "../util.js";
import { PAGE_STRIP_STYLES } from "./page-strip-styles.js";
import type { ShuColumnPane } from "./shu-column-pane.js";

const PageStripSchema = z.object({});

export class ShuPageStrip extends ShuElement<typeof PageStripSchema> {
	/** A control, not a view of data, contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static schema = PageStripSchema;
	static domainSelector = SHU_TAG.PAGE_STRIP;
	static observedHtmlAttributes = ["api-base", "testid-prefix"];

	static get styles(): CSSResultGroup {
		return PAGE_STRIP_STYLES;
	}

	/** The read access level the access indicator shows: the context's, or the reader's change of it. */
	#accessLevel: AccessQueryLevel = appAccessLevel();
	/** The corner controls and their popover: settings, access and authority, the time offset and playback, the status. */
	#corners = new PageStripCorners(this, {
		testIdPrefix: () => this.testIdPrefix,
		anchorTop: () => this.#anchorTop(),
		accessLevel: () => this.#accessLevel,
		setAccessLevel: (level) => this.#setAccessLevel(level),
	});
	#context = new SignalController(this, pageContext, (context) => {
		if (context) this.#accessLevel = context.accessLevel;
	});
	#trail = new SignalController(this, pageTrail, () => this.#updateBreadcrumb());
	#panes = new SignalController(this, stripPanes, () => this.#updateBreadcrumb());
	#activePane = new SignalController(this, activePane, () => this.#updateBreadcrumb());
	#docked = new SignalController(this, dockedPane, () => undefined);
	#status = new SignalController(this, pageStatus, (status) => this.#corners.setStatus(status));
	/** The types the page searches, which the search states: the strip offers them beside what the search found. */
	#types = new SignalController(this, pageTypes, () => undefined);
	/** The strip's height, which a docked pane stands above. */
	#footprint = new FootprintController(this, PAGE_STRIP_FOOTPRINT, () => this.offsetHeight);

	constructor() {
		super(PageStripSchema, {});
	}

	private get testIdPrefix(): string {
		return this.getAttribute("testid-prefix") || "";
	}

	protected override onConnected(): void {
		// A click in the strip opens, closes and pins the docked pane, so it isn't a click elsewhere that closes the pane.
		this.setAttribute(SHU_ATTR.DOCK_CONTROLS, "");
		void loadSlotExtensions(SHU_TAG.PAGE_STRIP, [PERMISSIONS_SLOT], this.getAttribute("api-base") || "", () => this.requestUpdate()).catch((err) =>
			reportToRun("warn", SHU_TAG.PAGE_STRIP, "optional UI extensions failed to load", { error: errorDetail(err) }),
		);
		// The run moving on changes where the cursor sits in it.
		if (!isOffline()) this.autoTeardown(this.subscribeBatched({ onBatch: () => this.#corners.showTime(this.timeCursor) }));
	}

	/** Say where the cursor sits in the run: `now` while every view shows now, and an offset once a moment is pinned. */
	protected onTimeSync(cursor: number | null): void {
		this.#corners.showTime(cursor);
	}

	protected updated(): void {
		this.#updateBreadcrumb();
	}

	/** Change the read access level the query reads at, as the access panel asks. */
	#setAccessLevel(level: AccessQueryLevel): void {
		this.#accessLevel = level;
		this.dispatchEvent(new CustomEvent(SHU_EVENT.FILTER_CHANGE, { detail: { asked: true, accessLevel: level }, bubbles: true, composed: true }));
		this.requestUpdate();
	}

	/** The breadcrumb names the search, then the columns and the one the reader is on. A docked pane isn't a column. */
	#updateBreadcrumb(): void {
		const breadcrumb = this.shadowRoot?.querySelector(SHU_TAG.BREADCRUMB) as (HTMLElement & { setTrail?: (label: string, cols: string[], active: number) => void }) | null;
		if (!breadcrumb?.setTrail) return;
		const columns = this.#panes.state.filter((pane) => !pane.docked);
		breadcrumb.setTrail(
			this.#trail.state,
			columns.filter((pane) => !pane.query).map((pane) => pane.label),
			columns.findIndex((pane) => pane.key === this.#activePane.state),
		);
	}

	/** The docked pane's element, where a pane is docked. */
	#dockedPaneElement(): ShuColumnPane | null {
		const key = this.#docked.state?.key;
		if (key === undefined) return null;
		return (Array.from(document.querySelectorAll(SHU_TAG.COLUMN_PANE)).find((pane) => (pane as HTMLElement).dataset.columnKey === key) as ShuColumnPane | undefined) ?? null;
	}

	/** A popover opens above the strip, or above an open docked pane, so it doesn't cover the pane's input line. */
	#anchorTop(): number {
		const top = this.getBoundingClientRect().top;
		const docked = this.#docked.state?.open ? this.#dockedPaneElement() : null;
		return docked ? Math.min(top, docked.getBoundingClientRect().top) : top;
	}

	/** State the type a reader chose on the document, where the search hears it wherever the actions bar stands. */
	#onTypeChange = (e: CustomEvent): void => {
		const key = e.detail?.value;
		if (key) this.dispatchEvent(new CustomEvent(SHU_EVENT.TYPE_CHOOSE, { detail: { key }, bubbles: true, composed: true }));
	};

	#onDockToggle = (): void => {
		const pane = this.#dockedPaneElement();
		if (!pane) return;
		if (this.#docked.state?.open) pane.close();
		else pane.open();
	};

	#onDockPin = (): void => {
		this.#dockedPaneElement()?.setPinned(!this.#docked.state?.pinned);
	};

	render(): TemplateResult {
		const docked = this.#docked.state;
		const prefix = this.testIdPrefix;
		return html`<div class="page-strip">
			${this.#corners.popoverTemplate()}
			<button class="pane-icon dock-toggle" ?disabled=${!docked} aria-expanded=${docked?.open ?? false} aria-label=${docked?.open ? "Close the docked pane" : "Open the docked pane"}
				data-testid=${`${prefix}dock-toggle`} @click=${this.#onDockToggle}>${docked?.open ? "▾" : "▴"}</button>
			${this.#corners.statusTemplate()}
			<shu-breadcrumb
				><shu-combobox slot=${SEARCH_SLOT} class="type-select" testid=${`${prefix}type-select`} placeholder="type..." .options=${this.#types.state.options}
					.value=${this.#types.state.selected} .shown=${this.#trail.state} @combo-change=${this.#onTypeChange}
					@click=${(e: Event) => e.stopPropagation()}></shu-combobox
			></shu-breadcrumb>
			${this.#corners.controlsTemplate()}
			<button class="pane-icon" ?disabled=${!docked} aria-pressed=${docked?.pinned ?? false} aria-label=${docked?.pinned ? "Unpin the docked pane" : "Pin the docked pane open"}
				data-testid=${`${prefix}dock-pin`} @click=${this.#onDockPin}>\u{1F4CC}</button>
		</div>`;
	}
}
