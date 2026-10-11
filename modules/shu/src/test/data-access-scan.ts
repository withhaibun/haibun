/**
 * The scan behind the data-access rule: the view files that import a data-access primitive from a module that sends
 * requests, where a view reads data through a controller it holds. A consumer's test imports the scan with its own
 * directories and its own list of views that may only shrink, so each repository holds its views to one rule.
 *
 * The scan matches imports. A view reaches a primitive only by importing it, and an import match finds an alias or a
 * wrapped reference without matching a comment or a string that names one. The request modules also export helpers a
 * view may read, so the scan matches only the primitives' names, and a namespace import of a request module.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { itemAt } from "@haibun/core/lib/util/item-at.js";

/** The name of a directory that holds views. */
export const VIEWS = "components";
/** The name of a directory that holds controllers. */
export const CONTROLLERS = "controllers";

/** The modules that send requests. An import of one by its package path matches the same suffix. */
const PLUMBING_MODULES = [
	"/conduit-controller.js",
	"/registry-controller.js",
	"/hydration-controller.js",
	"/authority-controller.js",
	"/page-authority-controller.js",
	"/quads-snapshot.js",
];

/** The names a view doesn't import. A controller holds the read each one performs. */
const DATA_ACCESS_PRIMITIVES = new Set(["conduit", "requireStep", "findStep", "callStep", "followCall", "pageAuthority", "signedHeaders"]);

/** The name an entry of an import's list takes from its module: `type x as y` takes `x`. */
function importedName(entry: string): string {
	const unqualified = entry.trim().replace(/^type\s+/, "");
	return itemAt(unqualified.split(/\s+as\s+/), 0);
}

/** Whether `source` imports a data-access primitive from a request module. */
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

/** Returns each directory under `root` that one of `names` names. */
export function viewDirectories(root: string, names: readonly string[]): string[] {
	return readdirSync(root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isDirectory() && names.includes(entry.name))
		.map((entry) => join(entry.parentPath, entry.name))
		.sort();
}

/** The view files in `dirs`, without their tests, by their names, and which of them import a data-access primitive. */
export function scanComponents(dirs: readonly string[]): { files: string[]; reachesRpc: (file: string) => boolean } {
	const paths = new Map(
		dirs.flatMap((dir) =>
			readdirSync(dir)
				.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts"))
				.map((file) => [file, join(dir, file)] as const),
		),
	);
	const pathOf = (file: string): string => {
		const path = paths.get(file);
		if (path === undefined) throw new Error(`${file} isn't a view file in ${dirs.join(", ")}`);
		return path;
	};
	return { files: [...paths.keys()], reachesRpc: (file: string) => importsDataAccessPrimitive(readFileSync(pathOf(file), "utf8")) };
}
