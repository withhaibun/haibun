#!/usr/bin/env node
/**
 * Points git at the hooks this package holds, so a commit in the repository that installs it runs the pre-commit check and a pull
 * links any new workspace. A checkout without git, such as an unpacked tarball, doesn't need hooks. A repository's `prepare` script
 * runs it: `haibun-install-hooks`.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

try {
	execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "pipe" });
} catch {
	console.info("haibun-install-hooks: this isn't a git checkout, so it leaves the hooks alone.");
	process.exit(0);
}
const hooks = fileURLToPath(new URL("../hooks", import.meta.url));
execFileSync("git", ["config", "core.hooksPath", hooks]);
if (existsSync("haibun/.git")) execFileSync("git", ["-C", "haibun", "config", "core.hooksPath", hooks]);
