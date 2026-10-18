/** The ports of an accessibility check: axe run in a page, the store its assertions are written to, and the clock. */
import type { Page } from "playwright";
import type { AxeResults } from "axe-core";
import type { TDiscourseStore } from "@haibun/core/lib/resources.js";
import type { TClock } from "@haibun/core/lib/actuality/ports.js";

/** axe run in a page: its results over the page's document. */
export type TAxe = { results(page: Page): Promise<AxeResults> };

/** The store an assertion is written to, and the clock that dates it. */
export type TEarlPorts = { store: TDiscourseStore; clock: TClock };
