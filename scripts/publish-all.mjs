#!/usr/bin/env node

/**
 * Publishes every module listed in modules/tsconfig.json at the root version.
 * Safe to re-run: already-published versions are treated as success.
 * Refuses to run if any module version does not match the root version.
 *
 * Usage: node scripts/publish-all.mjs [tag]
 *   tag: npm dist-tag (e.g. alpha, beta, rc). Omit for @latest.
 */

import { readFileSync } from "fs";
import { spawnSync } from "child_process";

const tag = process.argv[2];
const rootVersion = JSON.parse(readFileSync("./package.json", "utf-8")).version;

const tsconfig = JSON.parse(readFileSync("./modules/tsconfig.json", "utf-8"));
const modules = tsconfig.references.map((ref) => {
	const path = `./modules/${ref.path}`;
	const pkg = JSON.parse(readFileSync(`${path}/package.json`, "utf-8"));
	return { path, pkg };
});

const drift = modules.filter((m) => m.pkg.version !== rootVersion);
if (drift.length > 0) {
	console.error(`Version drift — root is ${rootVersion} but these modules differ:`);
	for (const m of drift) console.error(`  ${m.pkg.name}: ${m.pkg.version}`);
	console.error(`\nRun a version bump (e.g. npm run version-alpha) before publishing.`);
	process.exit(1);
}

const results = { published: [], skipped: [], failed: [] };

for (const m of modules) {
	const args = ["publish", "--access", "public"];
	if (tag) args.push("--tag", tag);
	const result = spawnSync("npm", args, { cwd: m.path, encoding: "utf-8" });
	const output = (result.stdout || "") + (result.stderr || "");

	if (result.status === 0) {
		console.info(`published ${m.pkg.name}@${rootVersion}${tag ? ` (@${tag})` : ""}`);
		results.published.push(m.pkg.name);
	} else if (/cannot publish over|previously published|403.*already/i.test(output)) {
		console.info(`skipped ${m.pkg.name}@${rootVersion} (already published)`);
		results.skipped.push(m.pkg.name);
	} else {
		console.error(`FAILED ${m.pkg.name}@${rootVersion}`);
		console.error(output);
		results.failed.push(m.pkg.name);
	}
}

console.info(`\nSummary: ${results.published.length} published, ${results.skipped.length} skipped, ${results.failed.length} failed`);
if (results.failed.length > 0) {
	console.error(`Failed: ${results.failed.join(", ")}`);
	process.exit(1);
}
