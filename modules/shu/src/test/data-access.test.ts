import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { scanComponents, viewDirectories, VIEWS } from "./data-access-scan.js";

/**
 * A view reads data through a controller it holds, and doesn't import a data-access primitive itself. The scan reads every
 * directory of shu named `components` (`data-access-scan.ts`). A consumer's test holds its own views to
 * the same scan.
 */

/** The views that import a data-access primitive. The list may only shrink: a view that moves onto a controller leaves
 *  it, and a new view that imports a primitive fails the first test. */
const PENDING_MIGRATION = new Set(["shu-ask.ts", "shu-polymorphic-graph-view.ts"]);

const { files, reachesRpc } = scanComponents(viewDirectories(fileURLToPath(new URL("../", import.meta.url)), [VIEWS]));

describe("a view's reads", () => {
	it("read through a controller, apart from the views PENDING_MIGRATION lists", () => {
		expect(files, "the scan reads the page's views and the graph view's").toEqual(expect.arrayContaining(["shu-entity-column.ts", "shu-graph.ts"]));
		const offenders = files.filter((f) => reachesRpc(f) && !PENDING_MIGRATION.has(f));
		expect(offenders, `${offenders.join(", ")} import a data-access primitive. Read the data through a ReactiveController the view holds (src/page/controllers).`).toEqual([]);
	});

	it("leave PENDING_MIGRATION once each reads through a controller", () => {
		const stale = [...PENDING_MIGRATION].filter((f) => !files.includes(f) || !reachesRpc(f));
		expect(stale, `${stale.join(", ")} don't import a data-access primitive: remove each from PENDING_MIGRATION.`).toEqual([]);
	});
});
