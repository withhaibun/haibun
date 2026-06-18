/**
 * Assertions for the column browser (the Miller-column strip), kept beside the element (the shu-graph-view.controls
 * pattern). WHICH column is focused is the browser's concern — deliberately NOT on any graph/view stepper. Reads the
 * live [active] pane from the page; the page-providing stepper (web-playwright) is found by duck-typing getPage, so
 * shu keeps no runtime dependency on it (mirrors how src/test/step-ui.ts injects it).
 *
 * Steps never lead with the article "the" — haibun treats such lines as narrative prose, not matchable steps.
 */
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/util/index.js";

type EvalPage = { evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T> };

export default class ShuColumnStripControls extends AStepper {
	description = "Column-browser (Miller columns) controls: click a column to activate it, assert which is active.";

	private page(): Promise<EvalPage> {
		const wp = this.getWorld().runtime.steppers?.find((s) => typeof (s as { getPage?: unknown }).getPage === "function") as { getPage(): Promise<EvalPage> } | undefined;
		if (!wp) throw new Error("ShuColumnStripControls: no page-providing stepper (web-playwright) in the world");
		return wp.getPage();
	}

	steps: TStepperSteps = {
		activateColumn: {
			// Activate a column the production way: a pointerdown anywhere in the pane (shu-column-pane's capture-phase
			// handler → COLUMN_ACTIVATE), so it works even where slotted content stops propagation. NOT "click column …" —
			// that collides with web-playwright's generic "click {target}".
			gwta: "activate column {match}",
			action: async ({ match }: { match: string }) => {
				const ok = await (await this.page()).evaluate((m) => {
					const pane = Array.from(document.querySelectorAll("shu-column-pane")).find((p) => ((p as HTMLElement).dataset.columnKey ?? "").includes(m)) as HTMLElement | undefined;
					if (!pane) return false;
					pane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
					return true;
				}, match);
				return ok ? actionOK() : actionNotOK(`no column pane matching "${match}"`);
			},
		},
		activeColumnMatches: {
			// {match} is a substring of the active pane's column key — e.g. an entity column's key is `e:${type}:${id}`,
			// so "e:Email:" proves a node click opened AND activated an Email column (open ⟹ active is unconditional).
			gwta: "active column matches {match}",
			action: async ({ match }: { match: string }) => {
				const cols = await (await this.page()).evaluate(() => {
					const panes = Array.from(document.querySelectorAll("shu-column-pane")) as (HTMLElement & { dataset: { columnKey?: string } })[];
					return {
						all: panes.map((p) => p.dataset.columnKey ?? "?"),
						active: (document.querySelector("shu-column-pane[active]") as HTMLElement | null)?.dataset.columnKey ?? null,
					};
				});
				if (cols.active === null) return actionNotOK(`no active column (panes: [${cols.all.join(", ")}])`);
				return cols.active.includes(match) ? actionOK() : actionNotOK(`active column key "${cols.active}" does not include "${match}" (panes: [${cols.all.join(", ")}])`);
			},
		},
	};
}
