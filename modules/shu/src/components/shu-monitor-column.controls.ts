/**
 * Inspection steps for shu-monitor-column, kept beside the element (the shu-graph-view.controls pattern). Counts the
 * rendered log rows across shadow boundaries so a feature can assert the monitor VIRTUALIZES: the DOM holds only the
 * rows in view (plus the virtualizer's small overscan), not every buffered event, no matter how long the run. Polls,
 * since the backfill and re-render land asynchronously. The page-providing stepper is duck-typed, so shu keeps no
 * dependency on it.
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

	/** Poll until the rendered row count settles (two equal, non-zero reads in a row), so a "fewer than" assertion reads
	 *  the stable virtualized count, never a mid-backfill snapshot that happens to be small. */
	private async waitForStable(page: EvalPage): Promise<number> {
		let prev = -1;
		for (let i = 0; i < 30; i++) {
			const n = await this.rowCount(page);
			if (n > 0 && n === prev) return n;
			prev = n;
			await page.waitForTimeout(200);
		}
		return prev;
	}

	/** Dispatch a pointerdown on the custom rail at its top or bottom, the way a click-to-seek does, so a feature can prove
	 *  the rail actually scrolls the virtualizer (a holey placeholder items array once made every seek a silent no-op). */
	private seekRail(page: EvalPage, where: string): Promise<boolean> {
		return page.evaluate((w: string) => {
			let rail: Element | null = null;
			const stack: Array<Document | ShadowRoot> = [document];
			while (stack.length > 0 && !rail) {
				const root = stack.pop();
				if (!root) break;
				const sb = root.querySelector("shu-scrollbar");
				if (sb?.shadowRoot) rail = sb.shadowRoot.querySelector(".rail"); // .rail lives in shu-scrollbar's shadow root
				for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) stack.push(el.shadowRoot);
			}
			if (!rail) return false;
			const r = rail.getBoundingClientRect();
			const clientY = w === "top" ? r.top + 3 : r.bottom - 3;
			rail.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: r.left + 7, clientY, pointerId: 1 }));
			return true;
		}, where);
	}

	/** The rail's top position glyph: the first visible row's ordinal. */
	private posTop(page: EvalPage): Promise<string> {
		return page.evaluate(() => {
			const stack: Array<Document | ShadowRoot> = [document];
			while (stack.length > 0) {
				const root = stack.pop();
				if (!root) break;
				const el = root.querySelector('[data-testid="scrollbar-pos-top"]');
				if (el) return (el.textContent || "").trim();
				for (const e of Array.from(root.querySelectorAll("*"))) if (e.shadowRoot) stack.push(e.shadowRoot);
			}
			return "";
		});
	}

	private async waitPosTop(page: EvalPage, ok: (v: string) => boolean): Promise<string> {
		let v = "";
		for (let i = 0; i < 25; i++) {
			v = await this.posTop(page);
			if (ok(v)) return v;
			await page.waitForTimeout(100);
		}
		return v;
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
		monitorShowsFewerThan: {
			gwta: "monitor shows fewer than {max} rows",
			action: async ({ max }: { max: string }) => {
				const want = Number(max);
				const n = await this.waitForStable(await this.page());
				return n > 0 && n < want ? actionOK() : actionNotOK(`monitor renders ${n} rows, expected a virtualized count below ${want}`);
			},
		},
		seekMonitorRail: {
			gwta: "seek the monitor rail to the {where}",
			action: async ({ where }: { where: string }) => {
				const ok = await this.seekRail(await this.page(), where);
				return ok ? actionOK() : actionNotOK("no shu-scrollbar rail found to seek");
			},
		},
		monitorFirstVisibleRow: {
			gwta: "monitor first visible row reads {ordinal}",
			action: async ({ ordinal }: { ordinal: string }) => {
				const v = await this.waitPosTop(await this.page(), (x) => x === ordinal);
				return v === ordinal ? actionOK() : actionNotOK(`monitor rail shows first visible row ${v || "(none)"}, expected ${ordinal}`);
			},
		},
		monitorFirstVisibleRowIsNot: {
			gwta: "monitor first visible row does not read {ordinal}",
			action: async ({ ordinal }: { ordinal: string }) => {
				const v = await this.waitPosTop(await this.page(), (x) => x !== "" && x !== ordinal);
				return v !== "" && v !== ordinal ? actionOK() : actionNotOK(`monitor rail still shows first visible row ${ordinal}; the seek did not move the window`);
			},
		},
	};
}
