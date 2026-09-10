// @vitest-environment jsdom
/**
 * The two stores a page can be reading through, held to the shared `IQuadStore` specification: the one in memory (a
 * report, a test, a server with no engine of its own) and the page's IndexedDB. IndexedDB runs on `fake-indexeddb`, so
 * the implementation a reader uses is covered in a unit test rather than only in a browser.
 */
import "fake-indexeddb/auto";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { describeQuadStore } from "@haibun/core/lib/test/quad-store-conformance.js";
import { IndexedDbQuadStore } from "./quad-store.js";
import { resetDeviceStoreIdb } from "./device-store.js";

const graphs = { first: "Comment", second: "Issue" };

describeQuadStore("in memory", () => new QuadStore(), graphs);
describeQuadStore("IndexedDB", () => new IndexedDbQuadStore(), graphs, { prepare: () => resetDeviceStoreIdb(), done: () => resetDeviceStoreIdb() });
