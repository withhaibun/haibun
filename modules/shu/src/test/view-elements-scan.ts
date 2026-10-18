/**
 * The scan behind the view element rules: the elements each view module defines, the class each extends, the shu tags each
 * renders, and the modules each imports as a value. An element a view module defines extends ShuElement, so each renders
 * through lit; and a view imports, as a value, the module that defines each tag it renders, so a view renders only
 * elements its own imports define, whichever bundle loads it. A view doesn't call `scrollIntoView`, which scrolls a page that
 * embeds shu too; it reveals an element through `revealInDocument`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { SHU_TAG } from "../domains/elements.js";

/** The class every element a view module defines extends, directly or through another class. */
export const ELEMENT_BASE = "ShuElement";

/** A view module: its path, its source without comments, and what it defines, extends, renders and imports. */
type TViewModule = { path: string; defines: Map<string, string>; extendsOf: Map<string, string>; renders: Set<string>; imports: Set<string>; scrollsIntoView: boolean };

const TAG_OF = new Map<string, string>(Object.entries(SHU_TAG));

/** Returns `source` without its block and line comments, which name tags they don't render. */
const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Returns the module paths `source` imports as values, resolved from `path`: a side-effect import, or an import of a name
 *  that isn't a type. */
function valueImports(path: string, source: string): Set<string> {
	const out = new Set<string>();
	for (const match of source.matchAll(/import\s+(?:(type\s+)?(\{[^}]*\}|\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?)\s+from\s+)?"(\.[^"]+)"/g)) {
		const [, typeOnly, names] = match;
		if (typeOnly !== undefined) continue;
		if (
			names !== undefined &&
			names.startsWith("{") &&
			names
				.slice(1, -1)
				.split(",")
				.every((entry) => entry.trim() === "" || entry.trim().startsWith("type "))
		)
			continue;
		out.add(resolve(dirname(path), itemAt(match, 3).replace(/\.js$/, ".ts")));
	}
	return out;
}

/** Reads a view module. */
function readView(path: string): TViewModule {
	const source = withoutComments(readFileSync(path, "utf8"));
	const defines = new Map<string, string>();
	for (const match of source.matchAll(/defineElement\(\s*(?:SHU_TAG\.(\w+)|"(shu-[\w-]+)")\s*,\s*(\w+)\s*\)/g)) {
		const [, key, literal] = match;
		const tag = key === undefined ? literal : TAG_OF.get(key);
		if (tag === undefined) throw new Error(`${path} defines SHU_TAG.${key}, which SHU_TAG doesn't hold`);
		defines.set(tag, itemAt(match, 3));
	}
	const extendsOf = new Map<string, string>();
	for (const match of source.matchAll(/class\s+(\w+)(?:<[^{]*?>)?\s+extends\s+(\w+)/g)) extendsOf.set(itemAt(match, 1), itemAt(match, 2));
	const renders = new Set([...source.matchAll(/<(shu-[a-z0-9-]+)[\s>/]/g)].map((match) => itemAt(match, 1)));
	return { path, defines, extendsOf, renders, imports: valueImports(path, source), scrollsIntoView: /\.scrollIntoView\(/.test(source) };
}

/** Returns the modules under `root`, without tests, fakes and declarations. */
export function readModules(root: string): TViewModule[] {
	return readdirSync(root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.includes(".test-") && !entry.name.endsWith(".d.ts"))
		.map((entry) => readView(join(entry.parentPath, entry.name)));
}

/** Returns the modules among `modules` in one of the directories `dirs`. */
export const inDirectories = (modules: readonly TViewModule[], dirs: readonly string[]): TViewModule[] => modules.filter((m) => dirs.includes(dirname(m.path)));

/** Returns each element a view defines whose class doesn't extend ELEMENT_BASE, as `tag (class extends base)`, reading each
 *  class's base among `modules`. */
export function elementsOffBase(views: readonly TViewModule[], modules: readonly TViewModule[]): string[] {
	const extendsOf = new Map(modules.flatMap((v) => [...v.extendsOf]));
	const reaches = (cls: string, seen: Set<string> = new Set()): boolean => {
		const base = extendsOf.get(cls);
		if (base === undefined || seen.has(cls)) return false;
		return base === ELEMENT_BASE || reaches(base, seen.add(cls));
	};
	return views.flatMap((v) => [...v.defines].filter(([, cls]) => !reaches(cls)).map(([tag, cls]) => `${tag} (${cls} extends ${extendsOf.get(cls)})`));
}

/** Returns each tag a view renders without defining it or importing, as a value, the module among `modules` that defines
 *  it, as `view: tag`, and each tag a view renders that a module doesn't define. */
export function tagsUnimported(views: readonly TViewModule[], modules: readonly TViewModule[]): string[] {
	const definer = new Map(modules.flatMap((v) => [...v.defines.keys()].map((tag) => [tag, v.path] as const)));
	return views.flatMap((v) =>
		[...v.renders].flatMap((tag) => {
			const path = definer.get(tag);
			if (path === undefined) return [`${v.path}: ${tag}, which a module doesn't define`];
			return path === v.path || v.imports.has(path) ? [] : [`${v.path}: ${tag}`];
		}),
	);
}

/** Returns the views that call `scrollIntoView`. */
export const scrollingViews = (views: readonly TViewModule[]): string[] => views.filter((v) => v.scrollsIntoView).map((v) => v.path);
