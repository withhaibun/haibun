import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { scanComponents } from "./data-access-scan.js";

/**
 * Guardrail for the controller pattern (see ./index.ts). A component reads data through a controller it holds: it must
 * not reassemble the raw RPC/store primitives itself. This test fails the build when one does, so the next feature
 * reuses a controller instead of reinventing the plumbing.
 *
 * The scan itself lives in `data-access-scan.ts`, which a consumer's components are held to as well.
 */

// Components that predate the controller pattern and still reach the RPC directly. This list may only SHRINK: migrate
// one onto a controller, then delete it here. A NEW component that reaches the RPC fails the first test below.
const PENDING_MIGRATION = new Set([
	"shu-affordances-panel.ts",
	"shu-domain-chain-view.ts",
	"shu-kihan-chat.ts",
	"shu-step-caller.ts",
	"shu-step-detail.ts",
	"shu-thread-column.ts",
	// Arrived with this debt when the graph view moved in from a consumer, which is why they are here rather than the
	// list having grown: each still fetches for itself instead of holding a controller.
	"shu-class-browser.ts",
	"shu-polymorphic-graph-view.ts",
]);

const { files, reachesRpc } = scanComponents(fileURLToPath(new URL("../components/", import.meta.url)));

describe("component data-access discipline", () => {
	it("no component reaches the RPC/store directly, data access goes through a controller in src/controllers", () => {
		const offenders = files.filter((f) => reachesRpc(f) && !PENDING_MIGRATION.has(f));
		expect(
			offenders,
			`${offenders.join(", ")} import a data-access primitive. Component data access goes through a ReactiveController held by the view, see src/controllers.`,
		).toEqual([]);
	});

	it("PENDING_MIGRATION has no stale entries: a migrated component must be removed from the allowlist", () => {
		const stale = [...PENDING_MIGRATION].filter((f) => !files.includes(f) || !reachesRpc(f));
		expect(stale, `${stale.join(", ")} no longer reach the RPC directly; remove them from PENDING_MIGRATION.`).toEqual([]);
	});
});
