/** The browser pages port: the property readers of the locator domains and of `browser-page` read the live page through
 * it, so a comparison of an element's text is checked at the page and only the verdict and the byte length cross to
 * Node. Every read runs inside the session's scope, so a statement the `in {container}, {what}` combinator scopes finds
 * its elements within the container, an iframe included. */
import type { Locator, Page } from "playwright";
import { globSource } from "@haibun/core/lib/domains/domains.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import type { TBrowserPages, TLocatorMode, TTextVerdict } from "../domains/web-playwright.js";
import type { BrowserSession, TPageScope } from "./browser-session.js";

/** The Playwright error a wait ends with once its bound passes without the element. */
const TIMEOUT_ERROR = "TimeoutError";

/** Returns whether the error is a wait that reached its bound, which reads of absent elements treat as an absent element. */
const timedOut = (error: unknown): boolean => error instanceof Error && error.name === TIMEOUT_ERROR;

/** The locator of the target, found the way the domain's row of `PAGE_LOCATORS` locates. */
function locate(scope: TPageScope, mode: TLocatorMode, target: string): Locator {
	const method = scope[mode.method as "locator"].bind(scope) as (argument: string, options?: { exact: boolean }) => Locator;
	return mode.exact ? method(`${mode.prefix}${target}`, { exact: true }) : method(`${mode.prefix}${target}`);
}

/** The page of the tab the subject numbers, or undefined where that tab is absent: a read never opens one. */
async function pageOfTab(session: BrowserSession, world: TWorld, tab: number): Promise<Page | undefined> {
	const pages = session.pages;
	if (pages === undefined || !pages.hasPage(world.tag.featureNum, tab)) return undefined;
	return await pages.page(world.tag.featureNum, tab);
}

/** Builds the port the web stepper publishes on the world's runtime as each feature starts. */
export function browserPages(session: BrowserSession, world: TWorld): TBrowserPages {
	const { featureNum } = world.tag;
	/** Runs the action at the first element the target locates, or undefined where the element doesn't arrive by the session's timeout. */
	const atFirst = async <TReturn>(mode: TLocatorMode, target: string, action: (element: Element, argument: string) => TReturn | Promise<TReturn>): Promise<TReturn | undefined> => {
		try {
			return await session.withScope(async (scope) => await locate(scope, mode, target).first().evaluate(action, ""));
		} catch (error) {
			if (timedOut(error)) return undefined;
			throw error;
		}
	};
	return {
		matches: (mode, target) => session.withScope(async (scope) => await locate(scope, mode, target).count()),
		isVisible: (mode, target) => session.withScope(async (scope) => await locate(scope, mode, target).first().isVisible()),
		textOf: async (mode, target) => await atFirst(mode, target, (element) => element.textContent ?? undefined),
		checkText: async (mode, target, operator, expected): Promise<TTextVerdict | undefined> => {
			// A glob is given as its text; the page checks the comparison, and only the verdict and the length cross.
			const seek = operator === "matches" ? globSource(expected) : expected;
			const verdict = await session
				.withScope(async (scope) =>
					locate(scope, mode, target)
						.first()
						.evaluate(
							(element, stated) => {
								const text = element.textContent ?? "";
								const holds =
									stated.operator === "is"
										? text === stated.expected
										: stated.operator === "contains"
											? text.includes(stated.expected)
											: new RegExp(stated.expected, "s").test(text);
								return { holds, byteLength: new TextEncoder().encode(text).length };
							},
							{ operator, expected: seek },
						),
				)
				.catch((error: unknown) => {
					if (timedOut(error)) return undefined;
					throw error;
				});
			return verdict;
		},
		valueOf: (mode, target) =>
			atFirst(mode, target, (element) => ("value" in element && typeof (element as HTMLInputElement).value === "string" ? (element as HTMLInputElement).value : undefined)),
		attributeOf: async (mode, target, name) => {
			try {
				return (await session.withScope(async (scope) => await locate(scope, mode, target).first().getAttribute(name))) ?? undefined;
			} catch (error) {
				if (timedOut(error)) return undefined;
				throw error;
			}
		},
		uri: async (tab) => (await pageOfTab(session, world, tab))?.url(),
		title: async (tab) => {
			const page = await pageOfTab(session, world, tab);
			return await page?.title();
		},
		cookie: async (_tab, name) => {
			const cookies = await session.pages?.context(featureNum)?.cookies();
			return cookies?.find((cookie) => cookie.name === name)?.value;
		},
		query: async (tab, name) => {
			const uri = (await pageOfTab(session, world, tab))?.url();
			return uri === undefined ? undefined : (new URL(uri).searchParams.get(name) ?? undefined);
		},
	};
}
