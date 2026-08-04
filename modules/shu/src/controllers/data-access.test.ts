import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guardrail for the controller pattern (see ./index.ts). A component reads data through a controller it holds — it must
 * not reassemble the raw RPC/store primitives itself. This test fails the build when one does, so the next feature
 * reuses a controller instead of reinventing the plumbing.
 *
 * Matching is on IMPORTS, not call syntax: a component can only reach a primitive by importing it, and an import
 * match catches what a call-shape regex misses (aliasing, a wrapped reference) without tripping on a comment or
 * string that mentions a name. The plumbing modules also export benign helpers (isOffline, the step catalogues),
 * so only the primitive NAMES are banned — plus a namespace import of a plumbing module, which would hide a
 * primitive behind a qualifier.
 */
const PLUMBING_MODULES = ["/hypermedia.js", "/pane-fetch.js", "/rpc-registry.js"];
const PRIMITIVES = new Set(["conduit", "requireStep", "findStep", "callStep"]);

function importsPrimitive(source: string): boolean {
	for (const [, typeOnly, clause, names, spec] of source.matchAll(/import\s+(type\s+)?(\{([^}]*)\}|\*\s+as\s+\w+)\s+from\s+"([^"]+)"/g)) {
		if (typeOnly || !PLUMBING_MODULES.some((m) => spec.endsWith(m))) continue;
		if (clause.startsWith("*")) return true;
		const imported = names.split(",").map(
			(n) =>
				n
					.trim()
					.replace(/^type\s+/, "")
					.split(/\s+as\s+/)[0],
		);
		if (imported.some((n) => PRIMITIVES.has(n))) return true;
	}
	return false;
}

// Components that predate the controller pattern and still reach the RPC directly. This list may only SHRINK: migrate
// one onto a controller, then delete it here. A NEW component that reaches the RPC fails the first test below.
const PENDING_MIGRATION = new Set([
	"shu-actions-bar.ts",
	"shu-affordances-panel.ts",
	"shu-domain-chain-view.ts",
	"shu-kihan-chat.ts",
	"shu-step-caller.ts",
	"shu-step-detail.ts",
	"shu-filter-column.ts",
	"shu-thread-column.ts",
]);

const componentsDir = fileURLToPath(new URL("../components/", import.meta.url));
const componentFiles = readdirSync(componentsDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const reachesRpc = (f: string) => importsPrimitive(readFileSync(componentsDir + f, "utf8"));

describe("component data-access discipline", () => {
	it("no component reaches the RPC/store directly — data access goes through a controller in src/controllers", () => {
		const offenders = componentFiles.filter((f) => reachesRpc(f) && !PENDING_MIGRATION.has(f));
		expect(
			offenders,
			`${offenders.join(", ")} import conduit/requireStep/findStep/callStep. Component data access goes through a ReactiveController held by the view — see src/controllers/index.ts. Add or use a controller and render from it; don't reassemble RPC in a component.`,
		).toEqual([]);
	});

	it("PENDING_MIGRATION has no stale entries — a migrated component must be removed from the allowlist", () => {
		const stale = [...PENDING_MIGRATION].filter((f) => !componentFiles.includes(f) || !reachesRpc(f));
		expect(stale, `${stale.join(", ")} no longer reach the RPC directly; remove them from PENDING_MIGRATION.`).toEqual([]);
	});
});
