/** The ports of an accessibility check: axe run in a page, and the store that holds its assertions. */
import type { Page } from "playwright";
import type { AxeResults } from "axe-core";
import type { TDiscourseStore } from "@haibun/core/lib/domains/resources.js";

/** axe run in a page: its results over the page's document. */
export type TAxe = { results(page: Page): Promise<AxeResults> };

/** The store an assertion is written to, which dates it. */
export type TEarlPorts = { store: TDiscourseStore };
