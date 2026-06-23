#!/usr/bin/env node
// Delete build outputs whose TypeScript source no longer exists, so a removed-from-source module fails loudly
// (module-not-found) instead of silently resolving to a stale artifact through the package "./*" -> "./build/*"
// exports map. (A deleted stepper survived its own deletion exactly this way and loaded pre-rename code.)
//
// Keys off the .d.ts file: tsc emits one per compiled source, esbuild bundles and copied assets do not — so bundles
// (e.g. build/shu-bundle.js, build/assets/*) and non-TS files are never considered. All modules compile src -> build,
// so build/<rel>.d.ts is orphaned when no src/<rel>.{ts,tsx,mts,cts,d.ts} exists; its .js/.d.ts/.map siblings go with it.
//
// Usage: node scripts/prune-orphaned-build.mjs [--dry-run] [moduleDir ...]   (default: every modules/* with src + build)
import { readdirSync, existsSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_EXTS = [".ts", ".tsx", ".mts", ".cts", ".d.ts"];
const OUTPUT_EXTS = [".js", ".js.map", ".d.ts", ".d.ts.map"];

function walk(dir, out = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

function pruneModule(moduleDir, dryRun) {
	const buildDir = join(moduleDir, "build");
	const srcDir = join(moduleDir, "src");
	if (!existsSync(buildDir) || !existsSync(srcDir)) return [];
	const removed = [];
	for (const file of walk(buildDir)) {
		if (!file.endsWith(".d.ts")) continue;
		const rel = relative(buildDir, file).slice(0, -".d.ts".length);
		if (SRC_EXTS.some((ext) => existsSync(join(srcDir, rel + ext)))) continue;
		for (const ext of OUTPUT_EXTS) {
			const orphan = join(buildDir, rel + ext);
			if (!existsSync(orphan)) continue;
			if (!dryRun) rmSync(orphan);
			removed.push(relative(moduleDir, orphan));
		}
	}
	return removed;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targets = args.filter((a) => a !== "--dry-run");
const moduleDirs = targets.length ? targets : readdirSync("modules").map((m) => join("modules", m));

let total = 0;
for (const dir of moduleDirs) {
	let removed;
	try {
		removed = pruneModule(dir, dryRun);
	} catch {
		continue; // not a buildable module
	}
	if (removed.length === 0) continue;
	total += removed.length;
	console.log(`[prune-orphaned-build] ${dir}: ${dryRun ? "would remove" : "removed"} ${removed.length} orphaned artifact(s)`);
	for (const r of removed) console.log(`  - ${r}`);
}
console.log(`[prune-orphaned-build] ${dryRun ? "dry run — " : ""}${total} orphaned artifact(s)${dryRun ? " would be removed" : " removed"}.`);
