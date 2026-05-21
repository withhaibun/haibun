#!/usr/bin/env node

/**
 * Called by npm `version` lifecycle hook.
 * Propagates the new root version to every module listed in modules/tsconfig.json
 * and updates currentVersion.ts.
 *
 * modules/tsconfig.json references are the single source of truth for "what is a haibun module."
 * Add a module there to include it in the build, version sync, and publish.
 */

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const rootPkg = JSON.parse(readFileSync("./package.json", "utf-8"));
const version = process.argv[2] || rootPkg.version;

rootPkg.version = version;
writeFileSync("./package.json", JSON.stringify(rootPkg, null, 2) + "\n");
console.info(`updated ./package.json to ${version}`);

const currentVersionFile = "./modules/core/src/currentVersion.ts";
writeFileSync(currentVersionFile, `export const currentVersion = '${version}';\n`);
console.info(`updated ${currentVersionFile} to ${version}`);

const tsconfig = JSON.parse(readFileSync("./modules/tsconfig.json", "utf-8"));
const modulePkgFiles = tsconfig.references.map((ref) => `./modules/${ref.path}/package.json`);

for (const pkgFile of modulePkgFiles) {
	const pkg = JSON.parse(readFileSync(pkgFile, "utf-8"));
	pkg.version = version;
	writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
	console.info(`updated ${pkg.name} to ${version}`);
}

execSync(`git add ./package.json ${currentVersionFile} ${modulePkgFiles.join(" ")}`, { stdio: "inherit" });
