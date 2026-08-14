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
 * only the primitive NAMES are banned — plus a namespace import of a plumbing module, which would hide a primitive
 * behind a qualifier.
 */
import { readdirSync, readFileSync } from "node:fs";

/** The modules that own the wire. A consumer importing them by package path matches on the same suffixes. */
export const PLUMBING_MODULES = ["/hypermedia.js", "/pane-fetch.js", "/rpc-registry.js"];

/** The names a component may not import: each one reassembles data access the controller already holds. */
export const DATA_ACCESS_PRIMITIVES = new Set(["conduit", "requireStep", "findStep", "callStep", "fetchIndividuals", "sessionCredential"]);

/** True when this source imports a data-access primitive from a plumbing module. */
export function importsDataAccessPrimitive(source: string): boolean {
	for (const [, typeOnly, clause, names, spec] of source.matchAll(/import\s+(type\s+)?(\{([^}]*)\}|\*\s+as\s+\w+)\s+from\s+"([^"]+)"/g)) {
		if (typeOnly || !PLUMBING_MODULES.some((m) => spec.endsWith(m))) continue;
		if (clause.startsWith("*")) return true;
		const imported = names.split(",").map((n) =>
			n
				.trim()
				.replace(/^type\s+/, "")
				.split(/\s+as\s+/)[0],
		);
		if (imported.some((n) => DATA_ACCESS_PRIMITIVES.has(n))) return true;
	}
	return false;
}

/** The component files in `dir` (excluding tests), and which of them reach the wire directly. */
export function scanComponents(dir: string): { files: string[]; reachesRpc: (file: string) => boolean } {
	const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"));
	return { files, reachesRpc: (file: string) => importsDataAccessPrimitive(readFileSync(dir + file, "utf8")) };
}
