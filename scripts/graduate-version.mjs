#!/usr/bin/env node

/**
 * Strip the prerelease suffix from the current version.
 * e.g. 3.8.5-rc.1 -> 3.8.5
 * Errors if the current version doesn't have a prerelease suffix.
 */

import { readFileSync } from "fs";
import { execSync } from "child_process";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));
const dashIndex = version.indexOf("-");

if (dashIndex === -1) {
	console.error(`Current version ${version} is already a release: it doesn't have an -alpha, -beta or -rc suffix. Run this script only on a prerelease version.`);
	process.exit(1);
}

const graduated = version.slice(0, dashIndex);
execSync(`npm version ${graduated}`, { stdio: "inherit" });
