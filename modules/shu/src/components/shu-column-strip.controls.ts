/**
 * Assertions for the column browser (the Miller-column strip), kept beside the element (the the polymorphic view's controls
 * pattern). WHICH column is focused is the browser's concern — deliberately NOT on any graph/view stepper. Reads the
 * live [active] pane from the page; the page-providing stepper (web-playwright) is found by duck-typing getPage, so
 * shu keeps no runtime dependency on it (mirrors how src/test/step-ui.ts injects it).
 *
 * Steps never lead with the article "the" — haibun treats such lines as narrative prose, not matchable steps.
 */
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/util/index.js";

import { pollUntil, type EvalPage } from "./controls-util.js";

export default class ShuColumnStripControls extends AStepper {
	description = "Column-browser (Miller columns) controls: click a column to activate it, assert which is active.";

	private page(): Promise<EvalPage> {
		const wp = this.getWorld().runtime.steppers?.find((s) => typeof (s as { getPage?: unknown }).getPage === "function") as { getPage(): Promise<EvalPage> } | undefined;
		if (!wp) throw new Error("ShuColumnStripControls: no page-providing stepper (web-playwright) in the world");
		return wp.getPage();
	}

	steps: TStepperSteps = {
		annotatedBodyOwnsScroll: {
			// The annotated file must scroll in its OWN region with the native scrollbar hidden, so the glyph rail is the only
			// bar (the two-scrollbars report). Assert the region exists, is an overflow scroller, and shows no native gutter.
			gwta: "annotated body scrolls in its own region with no native scrollbar",
			action: async () => {
				const r = await (await this.page()).evaluate(() => {
					let el: HTMLElement | null = null;
					const stack: Array<Document | ShadowRoot> = [document];
					while (stack.length > 0 && !el) {
						const root = stack.pop();
						if (!root) break;
						el = root.querySelector(".annotated-scroll");
						for (const e of Array.from(root.querySelectorAll("*"))) if (e.shadowRoot) stack.push(e.shadowRoot);
					}
					if (!el) return { found: false, overflowY: "", gutter: 0, scrolls: false };
					return { found: true, overflowY: getComputedStyle(el).overflowY, gutter: el.offsetWidth - el.clientWidth, scrolls: el.scrollHeight > el.clientHeight };
				});
				if (!r.found) return actionNotOK("no .annotated-scroll region found");
				if (r.overflowY !== "auto" && r.overflowY !== "scroll") return actionNotOK(`the annotated content region is not a scroller (overflow-y: ${r.overflowY})`);
				if (r.gutter > 0) return actionNotOK(`a native scrollbar gutter (${r.gutter}px) is still present beside the glyph rail`);
				return actionOK();
			},
		},
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
		closeColumn: {
			// Close a column the production way: press its own close control, which is what a reader presses. Asserting
			// the column is gone afterwards is the point — a close that leaves the pane in place is the failure this
			// drives out, and it cannot be seen by dispatching the event directly.
			gwta: "close column {match}",
			action: async ({ match }: { match: string }) => {
				const page = await this.page();
				const pressed = await page.evaluate((m) => {
					const pane = Array.from(document.querySelectorAll("shu-column-pane")).find((p) => ((p as HTMLElement).dataset.columnKey ?? "").includes(m));
					if (!pane) return "no such column";
					const close = pane.shadowRoot?.querySelector("button.pane-close") as HTMLButtonElement | null;
					if (!close) return "the column offers no close control";
					close.click();
					return "";
				}, match);
				if (pressed) return actionNotOK(`close column "${match}": ${pressed}`);
				const open = await pollUntil(
					page,
					(p) =>
						p.evaluate(
							(m) =>
								Array.from(document.querySelectorAll("shu-column-pane"))
									.map((el) => (el as HTMLElement).dataset.columnKey ?? "?")
									.filter((k) => k.includes(m)),
							match,
						),
					(keys) => keys.length === 0,
				);
				if (open.length === 0) return actionOK();
				// The hash is the desired set's own record: still naming the column means the dismissal never reached it.
				const hash = await page.evaluate(() => location.hash);
				return actionNotOK(`the column matching "${match}" was closed but is still open: ${open.join(", ")}; hash=${hash}`);
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
