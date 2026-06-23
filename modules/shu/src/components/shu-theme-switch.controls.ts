/**
 * Control steps for shu-theme-switch's global settings, kept beside the element (the shu-graph-view.controls pattern).
 * Drives the real control the way a person's click does — open the settings popover, click the window-size button →
 * setWindowSize → the persisted-setting signal → every windowed view re-renders — so a feature proves "changing the data
 * window updates the views" end to end. The page-providing stepper (web-playwright) is found by duck-typing getPage, so
 * shu keeps no dependency on it (mirrors shu-column-strip.controls). Pierces shadow roots to find the control.
 *
 * Steps never lead with the article "the" — haibun treats such lines as narrative prose, not matchable steps.
 */
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/util/index.js";

type EvalPage = { evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>; waitForTimeout(ms: number): Promise<void> };

export default class ShuThemeSwitchControls extends AStepper {
	description = "shu-theme-switch settings controls: drive the global data window size the way a click does.";

	private page(): Promise<EvalPage> {
		const wp = this.getWorld().runtime.steppers?.find((s) => typeof (s as { getPage?: unknown }).getPage === "function") as { getPage(): Promise<EvalPage> } | undefined;
		if (!wp) throw new Error("ShuThemeSwitchControls: no page-providing stepper (web-playwright) in the world");
		return wp.getPage();
	}

	/** Click the first element matching `selector`, piercing shadow roots; returns whether one was found. */
	private deepClick(page: EvalPage, selector: string): Promise<boolean> {
		return page.evaluate((sel) => {
			const stack: Array<Document | ShadowRoot> = [document];
			while (stack.length > 0) {
				const root = stack.pop();
				if (!root) break;
				const el = root.querySelector(sel);
				if (el instanceof HTMLElement) {
					el.click();
					return true;
				}
				for (const node of Array.from(root.querySelectorAll("*"))) if (node.shadowRoot) stack.push(node.shadowRoot);
			}
			return false;
		}, selector);
	}

	steps: TStepperSteps = {
		setDataWindow: {
			gwta: "choose data window {size}",
			action: async ({ size }: { size: string }) => {
				const page = await this.page();
				const windowButton = `[data-testid="settings-window-size"] button[data-value="${size}"]`;
				if (await this.deepClick(page, windowButton)) return actionOK();
				// The settings popover is lazy — open it, then click the now-mounted control (it renders a tick later).
				await this.deepClick(page, 'button[aria-label="Settings"]');
				for (let i = 0; i < 25; i++) {
					if (await this.deepClick(page, windowButton)) return actionOK();
					await page.waitForTimeout(200);
				}
				return actionNotOK(`window-size button ${size} not found after opening settings`);
			},
		},
	};
}
