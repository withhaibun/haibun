#!/usr/bin/env node

/**
 * Strip the prerelease suffix from the current version.
 * e.g. 3.8.5-rc.1 -> 3.8.5
 * Errors if the current version has no prerelease suffix.
 */

import { readFileSync } from "fs";
import { execSync } from "child_process";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));
const dashIndex = version.indexOf("-");

if (dashIndex === -1) {
	console.error(`Current version ${version} is already a release (no -alpha/-beta/-rc suffix). Nothing to graduate.`);
	process.exit(1);
}

const graduated = version.slice(0, dashIndex);
execSync(`npm version ${graduated}`, { stdio: "inherit" });
