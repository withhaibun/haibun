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
// A file is compiler output iff a same-basename TS source sibling exists, so bundles (build/shu-bundle.js, build/assets/*),
// hand-written .d.ts (no .ts sibling), and pure-JS modules are never touched.
//
// Usage: node scripts/prune-orphaned-build.mjs [--dry-run] [dir ...]
//   default: stray output across the whole repo + orphaned build output per modules/*.
import { readdirSync, existsSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

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
