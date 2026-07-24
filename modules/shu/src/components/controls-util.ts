/**
 * Shared plumbing for the *.controls.ts inspection steppers: the duck-typed page handle and the shadow-walking readers
 * every controls file uses. Each helper embeds its own walk because evaluate() serializes the passed function — a walker
 * cannot be shared ACROSS evaluate bodies, so it is shared at the helper level instead: one helper per read shape,
 * selector-parameterized, reused by every stepper.
 */

/** The page a web-playwright-like stepper provides; duck-typed so shu keeps no dependency on it. */
export type EvalPage = { evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>; waitForTimeout(ms: number): Promise<void> };

/** Poll `read` until it satisfies `ok` (re-render / backfill land async); return the last value seen. */
export async function pollUntil<T>(page: EvalPage, read: (p: EvalPage) => Promise<T>, ok: (v: T) => boolean, tries = 25, ms = 200): Promise<T> {
	let v = await read(page);
	for (let i = 1; i < tries && !ok(v); i++) {
		await page.waitForTimeout(ms);
		v = await read(page);
	}
	return v;
}

/** Count elements matching `selector` across every shadow root, from the document down. */
export function countMatching(page: EvalPage, selector: string): Promise<number> {
	return page.evaluate((sel: string) => {
		let count = 0;
		const stack: Array<Document | ShadowRoot> = [document];
		while (stack.length > 0) {
			const root = stack.pop();
			if (!root) break;
			count += root.querySelectorAll(sel).length;
			for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) stack.push(el.shadowRoot);
		}
		return count;
	}, selector);
}

/** The trimmed text of the first element matching `selector` across shadow roots, "" if none. */
export function firstText(page: EvalPage, selector: string): Promise<string> {
	return page.evaluate((sel: string) => {
		const stack: Array<Document | ShadowRoot> = [document];
		while (stack.length > 0) {
			const root = stack.pop();
			if (!root) break;
			const el = root.querySelector(sel);
			if (el) return (el.textContent || "").trim();
			for (const e of Array.from(root.querySelectorAll("*"))) if (e.shadowRoot) stack.push(e.shadowRoot);
		}
		return "";
	}, selector);
}

/** An attribute of the first element matching `selector` across shadow roots, "" if none or unset. */
export function firstAttr(page: EvalPage, selector: string, attr: string): Promise<string> {
	return page.evaluate(([sel, a]: [string, string]) => {
		const stack: Array<Document | ShadowRoot> = [document];
		while (stack.length > 0) {
			const root = stack.pop();
			if (!root) break;
			const el = root.querySelector(sel);
			if (el) return el.getAttribute(a) ?? "";
			for (const e of Array.from(root.querySelectorAll("*"))) if (e.shadowRoot) stack.push(e.shadowRoot);
		}
		return "";
	}, [selector, attr]);
}

/** Whether any element matching `selector` across shadow roots contains `text`. */
export function hasText(page: EvalPage, selector: string, text: string): Promise<boolean> {
	return page.evaluate(([sel, t]: [string, string]) => {
		const stack: Array<Document | ShadowRoot> = [document];
		while (stack.length > 0) {
			const root = stack.pop();
			if (!root) break;
			for (const r of Array.from(root.querySelectorAll(sel))) if ((r.textContent ?? "").includes(t)) return true;
			for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) stack.push(el.shadowRoot);
		}
		return false;
	}, [selector, text]);
}

/** Dispatch a composed click on the first element matching `selector` across shadow roots; false if none exists. */
export function clickFirst(page: EvalPage, selector: string): Promise<boolean> {
	return page.evaluate((sel: string) => {
		let target: Element | null = null;
		const stack: Array<Document | ShadowRoot> = [document];
		while (stack.length > 0 && !target) {
			const root = stack.pop();
			if (!root) break;
			target = root.querySelector(sel);
			for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) stack.push(el.shadowRoot);
		}
		if (!target) return false;
		target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
		return true;
	}, selector);
}
