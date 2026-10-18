/** What a control reads and drives: the page web-playwright drives in a feature. */
import type { Page } from "playwright";
import type { AStorage } from "@haibun/domain-storage/domains/storage.js";

/** The page a control drives, and the storage web-playwright saves what a control captures to, where the world holds one. */
export type TControlledPage = { page(): Promise<Page>; storage(): AStorage | undefined };
