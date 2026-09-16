#!/usr/bin/env node
// Delete compiler output that shouldn't be in the tree. Two cases, both keyed off the source<->output pairing:
//
//  1. Orphaned BUILD output: a build/<rel>.{js,d.ts,map} whose src/<rel> source is gone. Without this a removed-from-
//     source module resolves to a stale artifact through the package "./*" -> "./build/*" exports map instead of failing
//     loudly (a deleted stepper survived its own deletion this way and loaded pre-rename code).
//
//  2. Stray output IN THE SOURCE TREE: a .js/.d.ts/.map sitting next to its .ts/.tsx source ANYWHERE outside build/
//     (src/, test fixtures, root config like vite.config.ts), where a misfired `tsc` (run with no outDir, e.g. from the
//     wrong cwd) emitted compiled output into the tree. esbuild's development condition ("./*" -> "./src/*") then resolves
//     a `.js` import to that stale compiled file instead of the source and breaks the bundle ("No matching export … for
//     import 'TActionResult'": it value-imports types the source elides). Build output belongs only in build/.
//
//  3. Missing BUILD output: a compiled src/<rel> source with no build/<rel>.js. `tsc -b` judges a module current by
//     modification time alone, so a source older than the module's build record (a file moved or restored with its
//     time) is never compiled, and the build succeeds without it. The module's build record is removed, so the next build
//     compiles every source, and this run fails naming each source it did not compile.
//
//  4. Stale BUILD record: a module's build record older than the declarations of a haibun module its sources import.
//     `tsc -b` tracks the projects a module references and not the packages it imports, so a module whose dependency's
//     declarations changed is judged current and is not type-checked against them, and the build succeeds. The module's
//     build record is removed, with the record of each module that imports it, and those modules are compiled again in
//     one build, dependencies first. A package's dependencies are not read, since a module can import one it doesn't list.
//
// A file is compiler output iff a same-basename TS source sibling exists, so bundles (build/shu-bundle.js, build/assets/*),
// hand-written .d.ts (no .ts sibling), and pure-JS modules are never touched.
//
// Usage: node scripts/prune-orphaned-build.mjs [--dry-run] [dir ...]
//   default: stray output across the whole repo + orphaned build output per modules/*.
import { readdirSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SOURCE_EXTS = [".ts", ".tsx", ".mts", ".cts"];
const OUTPUT_EXTS = [".js", ".js.map", ".d.ts", ".d.ts.map"];
// Dirs that legitimately hold compiled output or are not this repository's, never scanned for stray output.
const STRAY_SKIP = new Set(["node_modules", "build", "dist", "coverage", ".git", ".vscode"]);

function walk(dir, skip, out = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!skip.has(entry.name)) walk(p, skip, out);
		} else out.push(p);
	}
	return out;
}

/** True if any TS source sibling of `base` (the path with its output extension stripped) exists. */
function hasSource(base) {
	return SOURCE_EXTS.some((ext) => existsSync(base + ext));
}

/** Case 1, build/<rel> output whose source no longer exists. Keyed off the .d.ts (one per compiled source). */
function pruneOrphanedBuild(moduleDir, dryRun) {
	const buildDir = join(moduleDir, "build");
	const srcDir = join(moduleDir, "src");
	if (!existsSync(buildDir) || !existsSync(srcDir)) return [];
	const removed = [];
	for (const file of walk(buildDir, new Set())) {
		if (!file.endsWith(".d.ts")) continue;
		const rel = relative(buildDir, file).slice(0, -".d.ts".length);
		// A hand-written .d.ts source counts too, so a build .d.ts beside a src .d.ts is not orphaned.
		if (hasSource(join(srcDir, rel)) || existsSync(join(srcDir, rel + ".d.ts"))) continue;
		for (const ext of OUTPUT_EXTS) {
			const orphan = join(buildDir, rel + ext);
			if (!existsSync(orphan)) continue;
			if (!dryRun) rmSync(orphan);
			removed.push(relative(moduleDir, orphan));
		}
	}
	return removed;
}

/** Case 3, each compiled source under `moduleDir`/src with no build output, by its path under src without its extension. */
export function missingBuildOutput(moduleDir) {
	const buildDir = join(moduleDir, "build");
	const srcDir = join(moduleDir, "src");
	if (!existsSync(buildDir) || !existsSync(srcDir)) return [];
	return walk(srcDir, new Set())
		.filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.endsWith(".d.ts"))
		.map((file) => relative(srcDir, file).replace(/\.tsx?$/, ""))
		.filter((rel) => !existsSync(join(buildDir, `${rel}.js`)));
}

/** The newest modification time of the declarations under `buildDir`, or 0 where it holds none. */
function newestDeclaration(buildDir) {
	if (!existsSync(buildDir)) return 0;
	return walk(buildDir, new Set()).reduce((newest, file) => (file.endsWith(".d.ts") ? Math.max(newest, statSync(file).mtimeMs) : newest), 0);
}

/** The other modules under `modulesDir` each module's sources import, by the package names the modules declare. */
function importedModules(modulesDir) {
	const moduleDirs = readdirSync(modulesDir)
		.map((name) => join(modulesDir, name))
		.filter((moduleDir) => existsSync(join(moduleDir, "package.json")));
	const dirOf = new Map(moduleDirs.map((moduleDir) => [JSON.parse(readFileSync(join(moduleDir, "package.json"), "utf-8")).name, moduleDir]));
	return new Map(
		moduleDirs.map((moduleDir) => {
			const srcDir = join(moduleDir, "src");
			const sources = existsSync(srcDir) ? walk(srcDir, new Set()).filter((file) => SOURCE_EXTS.some((ext) => file.endsWith(ext))) : [];
			const names = new Set(sources.flatMap((file) => [...readFileSync(file, "utf-8").matchAll(/["'](@haibun\/[^/"']+)/g)].map((match) => match[1])));
			return [moduleDir, [...names].map((name) => dirOf.get(name)).filter((dir) => dir !== undefined && dir !== moduleDir)];
		}),
	);
}

/** Case 4, each module under `modulesDir` whose build record is older than the declarations of a module it imports, and
 *  each module that imports one of those, dependencies first. */
export function staleBuildRecords(modulesDir) {
	const imports = importedModules(modulesDir);
	const recorded = [...imports.keys()].filter((moduleDir) => existsSync(join(moduleDir, "tsconfig.tsbuildinfo")));
	const declaredAt = new Map([...imports.keys()].map((moduleDir) => [moduleDir, newestDeclaration(join(moduleDir, "build"))]));
	const stale = new Set(
		recorded.filter((moduleDir) => {
			const recordAt = statSync(join(moduleDir, "tsconfig.tsbuildinfo")).mtimeMs;
			return imports.get(moduleDir).some((dependency) => declaredAt.get(dependency) > recordAt);
		}),
	);
	// A module compiled again writes its declarations again, so a module that imports it is compiled again too.
	for (let grew = true; grew; ) {
		const importers = recorded.filter((moduleDir) => !stale.has(moduleDir) && imports.get(moduleDir).some((dependency) => stale.has(dependency)));
		for (const moduleDir of importers) stale.add(moduleDir);
		grew = importers.length > 0;
	}
	// Dependencies first. Modules that import each other stay in the order they were reached.
	const ordered = [];
	const place = (moduleDir, reaching) => {
		if (ordered.includes(moduleDir) || reaching.has(moduleDir)) return;
		for (const dependency of imports.get(moduleDir)) place(dependency, new Set([...reaching, moduleDir]));
		ordered.push(moduleDir);
	};
	for (const moduleDir of stale) place(moduleDir, new Set());
	return ordered.filter((moduleDir) => stale.has(moduleDir));
}

/** Case 2, compiler output (.js/.d.ts/.map) sitting next to its TS source, anywhere under `rootDir` except build/. */
function pruneStrayOutput(rootDir, dryRun) {
	if (!existsSync(rootDir)) return [];
	const removed = [];
	for (const file of walk(rootDir, STRAY_SKIP)) {
		const ext = OUTPUT_EXTS.find((e) => file.endsWith(e));
		if (!ext || !hasSource(file.slice(0, -ext.length))) continue; // no TS source sibling → hand-written .d.ts / real .js, keep
		if (!dryRun) rmSync(file);
		removed.push(relative(rootDir, file));
	}
	return removed;
}

// Run as a command, not when a test imports the checks.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const args = process.argv.slice(2);
	const dryRun = args.includes("--dry-run");
	const targets = args.filter((a) => a !== "--dry-run");

	let total = 0;
	const report = (label, removed) => {
		if (removed.length === 0) return;
		total += removed.length;
		console.log(`[prune-orphaned-build] ${label}: ${dryRun ? "would remove" : "removed"} ${removed.length} stray/orphaned artifact(s)`);
		for (const r of removed) console.log(`  - ${r}`);
	};

	if (targets.length) {
		for (const dir of targets) {
			try {
				report(dir, [...pruneStrayOutput(dir, dryRun), ...pruneOrphanedBuild(dir, dryRun)]);
			} catch {
				/* not a readable dir */
			}
		}
	} else {
		report(".", pruneStrayOutput(".", dryRun)); // stray output anywhere in the source tree
		for (const m of readdirSync("modules")) {
			try {
				report(join("modules", m), pruneOrphanedBuild(join("modules", m), dryRun)); // + orphaned build output per module
			} catch {
				/* not a buildable module */
			}
		}
	}
	console.log(`[prune-orphaned-build] ${dryRun ? "dry run, " : ""}${total} stray/orphaned artifact(s)${dryRun ? " would be removed" : " removed"}.`);
	const missing = readdirSync("modules")
		.map((m) => ({ moduleDir: join("modules", m), sources: missingBuildOutput(join("modules", m)) }))
		.filter(({ sources }) => sources.length > 0);
	for (const { moduleDir, sources } of missing) {
		rmSync(join(moduleDir, "tsconfig.tsbuildinfo"), { force: true });
		console.error(
			`[prune-orphaned-build] ${moduleDir}: ${sources.length} source(s) were not compiled, though the build succeeded; its build record is removed, so building again compiles them:`,
		);
		for (const source of sources) console.error(`  - src/${source}`);
	}
	if (missing.length > 0) process.exitCode = 1;
	const stale = staleBuildRecords("modules");
	if (stale.length > 0) {
		console.error(
			`[prune-orphaned-build] ${dryRun ? "would compile again" : "compiles again"} the modules whose build records are older than what they import: ${stale.join(", ")}`,
		);
		if (!dryRun) {
			for (const moduleDir of stale) rmSync(join(moduleDir, "tsconfig.tsbuildinfo"), { force: true });
			if (spawnSync("npx", ["tsc", "-b", ...stale], { stdio: "inherit" }).status !== 0)
				throw new Error(`[prune-orphaned-build] ${stale.join(", ")} did not compile against the declarations of the modules they import`);
		}
	}
}
