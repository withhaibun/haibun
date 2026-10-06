/**
 * The scan behind the data-access guardrail (see ./index.ts): which component files reach the RPC/store primitives
 * directly instead of holding a controller.
 *
 * Exported rather than kept inside shu's own test because a consumer's components are the same kind of thing and
 * drift the same way. A consumer imports this and brings its own directory and its own shrink-only allowlist, so
 * there is one rule and one implementation of it rather than a copy per repository.
 *
 * Matching is on IMPORTS, not call syntax: a component can only reach a primitive by importing it, and an import
 * match catches what a call-shape regex misses (aliasing, a wrapped reference) without tripping on a comment or
 * string that mentions a name. The plumbing modules also export benign helpers (isOffline, the step catalogues), so
 * only the primitive NAMES are banned, plus a namespace import of a plumbing module, which would hide a primitive
 * behind a qualifier.
 */
import { readdirSync, readFileSync } from "node:fs";
import { itemAt } from "@haibun/core/lib/util/item-at.js";

/** The modules that own the wire. A consumer importing them by package path matches on the same suffixes. */
const PLUMBING_MODULES = ["/hypermedia.js", "/pane-fetch.js", "/rpc-registry.js", "/page-key.js"];

/** The names a component may not import: each one reassembles data access the controller already holds. */
const DATA_ACCESS_PRIMITIVES = new Set(["conduit", "requireStep", "findStep", "callStep", "fetchIndividuals", "pageAuthority", "signedHeaders"]);

/** The name an entry of an import's list takes from its module: `type x as y` takes `x`. */
function importedName(entry: string): string {
	const unqualified = entry.trim().replace(/^type\s+/, "");
	return itemAt(unqualified.split(/\s+as\s+/), 0);
}

/** True when this source imports a data-access primitive from a plumbing module. */
function importsDataAccessPrimitive(source: string): boolean {
	for (const match of source.matchAll(/import\s+(type\s+)?(\{([^}]*)\}|\*\s+as\s+\w+)\s+from\s+"([^"]+)"/g)) {
		const [, typeOnly, , names] = match;
		const spec = itemAt(match, 4);
		if (typeOnly || !PLUMBING_MODULES.some((m) => spec.endsWith(m))) continue;
		// The namespace form (`* as name`) doesn't list names: it imports every one.
		if (names === undefined) return true;
		if (names.split(",").some((entry) => DATA_ACCESS_PRIMITIVES.has(importedName(entry)))) return true;
	}
	return false;
}

/** The component files in `dir` (excluding tests), and which of them reach the wire directly. */
export function scanComponents(dir: string): { files: string[]; reachesRpc: (file: string) => boolean } {
	const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"));
	return { files, reachesRpc: (file: string) => importsDataAccessPrimitive(readFileSync(dir + file, "utf8")) };
}
