import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guardrail for the controller pattern (see ./index.ts). A component reads data through a controller it holds — it must
 * not reassemble the raw RPC/store primitives itself. This test fails the build when one does, so the next feature
 * reuses a controller instead of reinventing the plumbing.
 */
const FORBIDDEN = /\b(conduit|requireStep|findStep|getStore)\s*\(/;

// Components that predate the controller pattern and still reach the RPC directly. This list may only SHRINK: migrate
// one onto a controller, then delete it here. A NEW component that reaches the RPC fails the first test below.
const PENDING_MIGRATION = new Set(["shu-actions-bar.ts", "shu-affordances-panel.ts", "shu-domain-chain-view.ts", "shu-kihan-chat.ts", "shu-step-caller.ts", "shu-step-detail.ts"]);

const componentsDir = fileURLToPath(new URL("../components/", import.meta.url));
const componentFiles = readdirSync(componentsDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const reachesRpc = (f: string) => FORBIDDEN.test(readFileSync(componentsDir + f, "utf8"));

describe("component data-access discipline", () => {
	it("no component reaches the RPC/store directly — data access goes through a controller in src/controllers", () => {
		const offenders = componentFiles.filter((f) => reachesRpc(f) && !PENDING_MIGRATION.has(f));
		expect(
			offenders,
			`${offenders.join(", ")} call conduit()/requireStep()/findStep()/getStore() directly. Component data access goes through a ReactiveController held by the view — see src/controllers/index.ts. Add or use a controller and render from it; don't reassemble RPC in a component.`,
		).toEqual([]);
	});

	it("PENDING_MIGRATION has no stale entries — a migrated component must be removed from the allowlist", () => {
		const stale = [...PENDING_MIGRATION].filter((f) => !componentFiles.includes(f) || !reachesRpc(f));
		expect(stale, `${stale.join(", ")} no longer reach the RPC directly; remove them from PENDING_MIGRATION.`).toEqual([]);
	});
});
