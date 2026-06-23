/**
 * Inspection steps for shu-monitor-column, kept beside the element (the shu-graph-view.controls pattern). Counts the
 * rendered log rows across shadow boundaries so a feature can assert the global data window bounds what the monitor
 * shows — the observable proof that a window-size change re-renders the view. Polls, since the re-render (and the
 * initial backfill) land asynchronously. The page-providing stepper is duck-typed, so shu keeps no dependency on it.
 *
 * Steps never lead with the article "the" — haibun treats such lines as narrative prose, not matchable steps.
 */
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/util/index.js";

type EvalPage = { evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>; waitForTimeout(ms: number): Promise<void> };

export default class ShuMonitorColumnControls extends AStepper {
	description = "shu-monitor-column inspection: count rendered log rows to assert the data window bounds the view.";

	private page(): Promise<EvalPage> {
		const wp = this.getWorld().runtime.steppers?.find((s) => typeof (s as { getPage?: unknown }).getPage === "function") as { getPage(): Promise<EvalPage> } | undefined;
		if (!wp) throw new Error("ShuMonitorColumnControls: no page-providing stepper (web-playwright) in the world");
		return wp.getPage();
	}

	private rowCount(page: EvalPage): Promise<number> {
		return page.evaluate(() => {
			let count = 0;
			const stack: Array<Document | ShadowRoot> = [document];
			while (stack.length > 0) {
				const root = stack.pop();
				if (!root) break;
				count += root.querySelectorAll('[data-testid="monitor-log-row"]').length;
				for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) stack.push(el.shadowRoot);
			}
			return count;
		});
	}

	/** Poll the rendered row count until it satisfies `ok` (the re-render / backfill is async); return the last seen. */
	private async waitForRows(page: EvalPage, ok: (n: number) => boolean): Promise<number> {
		let n = 0;
		for (let i = 0; i < 25; i++) {
			n = await this.rowCount(page);
			if (ok(n)) return n;
			await page.waitForTimeout(200);
		}
		return n;
	}

	steps: TStepperSteps = {
		monitorShowsMoreThan: {
			gwta: "monitor shows more than {min} rows",
			action: async ({ min }: { min: string }) => {
				const want = Number(min);
				const n = await this.waitForRows(await this.page(), (c) => c > want);
				return n > want ? actionOK() : actionNotOK(`monitor shows ${n} rows, expected more than ${want}`);
			},
		},
		monitorShowsExactly: {
			gwta: "monitor shows exactly {count} rows",
			action: async ({ count }: { count: string }) => {
				const want = Number(count);
				const n = await this.waitForRows(await this.page(), (c) => c === want);
				return n === want ? actionOK() : actionNotOK(`monitor shows ${n} rows, expected exactly ${want}`);
			},
		},
	};
}
