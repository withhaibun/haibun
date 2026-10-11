/** The page's panes, as a view opens, closes and activates them and the page opens its strip (`page/pipelines/panes.ts`). */
import { activePane, pageHashScope, pagePaneStrip, pagePanes, pagePreferences, pageRegistry, panesHeld } from "../root.js";
import * as Panes from "../pipelines/panes.js";
import * as PageHash from "../pipelines/page-hash.js";
import { heldCatalog, holdsCatalog } from "../pipelines/held-catalog.js";
import { recordComponent, uiOfComponent } from "../derivations/catalog.js";
import { storedSetting } from "../derivations/settings.js";
import * as Kinds from "../derivations/pane-kinds.js";
import { INITIAL_SHOWN_CONTROLS, ShownControlsSchema, shownControlsKey } from "../domains/settings.js";
import { SHU_ATTR, SHU_EVENT, SHU_TAG } from "../../domains/elements.js";
import type { TPagePane } from "../machines/panes.js";
import type { TPaneMarks, TStripElement } from "../ports.js";
import type { ShuEntityColumn } from "../components/shu-entity-column.js";
import type { ShuStepDefinition } from "../components/shu-step-definition.js";
import type { ShuActionColumn } from "../components/shu-action-column.js";
import type { ShuFilterColumn } from "../components/shu-filter-column.js";
import type { ShuTypeColumn } from "../components/shu-type-column.js";
import type { ShuThreadColumn } from "../components/shu-thread-column.js";

/** What a pane's kind reads from the catalog the page holds. A component pane restored in a carried page without the site's
 *  registry takes its tag as its title. */
export const PANE_CONTEXT: Kinds.TPaneContext = {
	recordComponent: (type) => recordComponent(heldCatalog(pageRegistry(), `the component of ${type}`), type),
	componentTitle: (tag) => {
		if (!holdsCatalog(pageRegistry())) return tag;
		const summary = uiOfComponent(heldCatalog(pageRegistry(), `the title of ${tag}`), tag)?.summary;
		return typeof summary === "string" ? summary : tag;
	},
};

/** What each pane kind's view is given once it attaches: the data its pane carries, through the view's own method. */
export const PANE_ATTACH: Panes.TPaneAttach = {
	entity: (d, view) => (view as ShuEntityColumn).open(d.id, d.persistedAs, d.selector),
	type: (d, view) => (view as ShuTypeColumn).open(d.persistedAs),
	"filter-eq": (d, view) => (view as ShuFilterColumn).openFiltered(d.predicate, d.value, d.persistedAs),
	"filter-prop": (d, view) => (view as ShuFilterColumn).openProperty(d.predicate, d.persistedAs),
	"filter-incoming": (d, view) => (view as ShuFilterColumn).openIncoming(d.subject, d.persistedAs),
	thread: (d, view) => (view as ShuThreadColumn).open(d.persistedAs, d.subject),
	step: (d, view) => (view as ShuStepDefinition).open(d.method),
	action: (d, view) => (view as ShuActionColumn).open(d.action),
	"views-picker": (d, view) => (view as HTMLElement & { setViews(v: unknown[]): void }).setViews(d.views),
};

/** The names the strip's panes carry. */
const MARKS: TPaneMarks = {
	paneTag: SHU_TAG.COLUMN_PANE,
	columnType: SHU_ATTR.COLUMN_TYPE,
	pinned: SHU_ATTR.PINNED,
	closable: SHU_ATTR.CLOSABLE,
	events: { minimize: SHU_EVENT.COLUMN_MINIMIZE, maximize: SHU_EVENT.COLUMN_MAXIMIZE, dock: SHU_EVENT.COLUMN_DOCK, expand: SHU_EVENT.COLUMN_EXPAND },
};

const scope = (): Panes.TPanesScope => ({
	machine: pagePanes(),
	held: panesHeld(),
	address: { get: () => PageHash.getHash(pageHashScope()), push: (hash) => PageHash.pushHash(pageHashScope(), hash) },
	active: activePane,
	minimizedBefore: (id) => pagePreferences().read(SHU_TAG.COLUMN_PANE, id)?.minimized === true,
	showsControls: (tag) =>
		storedSetting(`the controls of <${tag}>`, ShownControlsSchema, pagePreferences().read(SHU_TAG.COLUMN_PANE, shownControlsKey(tag)), INITIAL_SHOWN_CONTROLS).shown,
	showControlsAttribute: SHU_ATTR.SHOW_CONTROLS,
	kinds: PANE_CONTEXT,
});

/** Opens the panes on `strip`, with the panes the page always holds, and restores them at each arrival at an address. */
export function openStrip(strip: TStripElement, hooks: Panes.TPaneHooks, pagePanes: ReadonlyArray<TPagePane>): void {
	const paneStrip = pagePaneStrip(strip, MARKS);
	Panes.openStrip(scope(), paneStrip, hooks, pagePanes);
	// Each control and each arrival reads the page's panes as they are then.
	paneStrip.onControl((id, change) => Panes.control(scope(), id, change));
	PageHash.onHashChanged(pageHashScope(), restorePanes);
}

/** Reads the address into the panes it names. */
export const restorePanes = (): void => Panes.restoreFromAddress(scope());

/** Shows a pane, and makes it the active pane. */
export const requestPane = (pane: Kinds.DesiredPane): void => Panes.request(scope(), pane);

/** Shows a pane as a column after the pane that holds `source`. */
export const requestPaneFrom = (source: Element | Event, pane: Kinds.DesiredPane, addToSelection: boolean): void => Panes.requestFrom(scope(), source, pane, addToSelection);

/** Makes `id` the active pane. */
export const activatePane = (id: string): void => Panes.activate(scope(), id);

/** Closes a pane. */
export const dismissPane = (id: string): void => Panes.dismiss(scope(), id);

/** Returns the panes the page shows. */
export const shownPanes = (): Kinds.DesiredPane[] => [...pagePanes().state.get().desired.values()];

/** Whether the page shows the pane `id`. */
export const showsPane = (id: string): boolean => pagePanes().state.get().desired.has(id);

/** Returns the pane a column entry names, or null for an entry that doesn't name one. */
export const paneOfEntry = (raw: string): Kinds.DesiredPane | null => Kinds.parseColEntry(raw, PANE_CONTEXT);
