/**
 * Assertions for the column browser (the Miller-column strip), kept beside the element (the polymorphic view's controls
 * pattern). WHICH column is focused is the browser's concern, deliberately NOT on any graph/view stepper. Reads the
 * live [active] pane from the page.
 *
 * Steps never lead with the article "the", haibun treats such lines as narrative prose, not matchable steps.
 */
import { NameSchema } from "@haibun/core/lib/domains.js";
import type { Page } from "playwright";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/util/index.js";
import { INPUT_EVENT, STATE_MS, controlledPage, findsAtLeast } from "./controls-util.js";
import { SHU_TAG } from "../consts.js";

/** A column, by words of the key it is open under, such as `e:Email:` for an Email's column. */
const DOMAIN_COLUMN_MATCH = "column-match";
/** How long a column takes to open, close or become active after the page acts. */

/** The panes whose column key holds `match`, and are `active` where asked. */
const panesMatching = (page: Page, match: string, active = false) => page.locator(`${SHU_TAG.COLUMN_PANE}${active ? "[active]" : ""}[data-column-key*=${JSON.stringify(match)}]`);

/** Every pane's column key, and the active one's, for a refusal to state. */
const columnKeys = (page: Page) =>
	page.locator(SHU_TAG.COLUMN_PANE).evaluateAll((panes) => panes.map((p) => `${(p as HTMLElement).dataset.columnKey}${p.hasAttribute("active") ? " (active)" : ""}`));

export default class ShuColumnStripControls extends AStepper implements IHasCycles {
	description = "Column-browser (Miller columns) controls: click a column to activate it, assert which is active.";
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [{ selectors: [DOMAIN_COLUMN_MATCH], schema: NameSchema, description: "A column, by words of the key it is open under, such as e:Email: for an Email's column" }],
		}),
	};

	private page(): Promise<Page> {
		return controlledPage(this);
	}

	steps: TStepperSteps = {
		annotatedBodyOwnsScroll: {
			// The annotated file must scroll in its OWN region with the native scrollbar hidden, so the glyph rail is the only
			// bar (the two-scrollbars report). Assert the region exists, is an overflow scroller, and doesn't show a native gutter.
			gwta: "annotated body scrolls in its own region with no native scrollbar",
			action: async () => {
				const region = (await this.page()).locator(".annotated-scroll").first();
				if ((await region.count()) === 0) return actionNotOK("the page doesn't show an .annotated-scroll region");
				const r = await region.evaluate((el: HTMLElement) => ({ overflowY: getComputedStyle(el).overflowY, gutter: el.offsetWidth - el.clientWidth }));
				if (r.overflowY !== "auto" && r.overflowY !== "scroll") return actionNotOK(`the annotated content region is not a scroller (overflow-y: ${r.overflowY})`);
				if (r.gutter > 0) return actionNotOK(`a native scrollbar gutter (${r.gutter}px) is still present beside the glyph rail`);
				return actionOK();
			},
		},
		activateColumn: {
			// Activate a column the production way: a pointerdown anywhere in the pane (shu-column-pane's capture-phase
			// handler → COLUMN_ACTIVATE), so it works even where slotted content stops propagation. NOT "click column …":
			// that collides with web-playwright's generic "click {target}".
			gwta: `activate column {match: ${DOMAIN_COLUMN_MATCH}}`,
			action: async ({ match }: { match: string }) => {
				const pane = panesMatching(await this.page(), match).first();
				if ((await pane.count()) === 0) return actionNotOK(`the page doesn't show a column matching "${match}"`);
				await pane.dispatchEvent(INPUT_EVENT.pointerdown, { bubbles: true, composed: true });
				return actionOK();
			},
		},
		closeColumn: {
			// Close a column the production way: press its own close control, which is what a reader presses. Asserting
			// the column is gone afterwards is the point: a close that leaves the pane in place is the failure this
			// drives out, and it cannot be seen by dispatching the event directly.
			gwta: `close column {match: ${DOMAIN_COLUMN_MATCH}}`,
			action: async ({ match }: { match: string }) => {
				const page = await this.page();
				const panes = panesMatching(page, match);
				if ((await panes.count()) === 0) return actionNotOK(`close column "${match}": the page doesn't show such a column`);
				const close = panes.first().locator("button.pane-close");
				if ((await close.count()) === 0) return actionNotOK(`close column "${match}": the column doesn't offer a close control`);
				await close.click();
				const closed = await panes
					.first()
					.waitFor({ state: "detached", timeout: STATE_MS })
					.then(
						() => true,
						() => false,
					);
				if (closed) return actionOK();
				// The hash is the desired set's own record: still naming the column means the dismissal never reached it.
				return actionNotOK(`the column matching "${match}" was closed but is still open: ${(await columnKeys(page)).join(", ")}; hash=${await page.evaluate(() => location.hash)}`);
			},
		},
		activeColumnMatches: {
			// {match} is a substring of the active pane's column key, e.g. an entity column's key is `e:${type}:${id}`,
			// so "e:Email:" proves a node click opened AND activated an Email column (open ⟹ active is unconditional).
			// A page opens its columns once it has loaded, so the step waits for a matching column to be active.
			gwta: `active column matches {match: ${DOMAIN_COLUMN_MATCH}}`,
			action: async ({ match }: { match: string }) => {
				const page = await this.page();
				if (await findsAtLeast(panesMatching(page, match, true), 1, STATE_MS)) return actionOK();
				return actionNotOK(`the active column doesn't match "${match}" (panes: [${(await columnKeys(page)).join(", ")}])`);
			},
		},
	};
}
