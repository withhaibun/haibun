#!/usr/bin/env node
/**
 * Points git at the hooks this package holds, so a commit in the repository that installs it runs the pre-commit check. A checkout
 * without git, such as an unpacked tarball, doesn't need hooks. A repository's `prepare` script runs it: `haibun-install-hooks`.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

try {
	execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "pipe" });
} catch {
	console.info("haibun-install-hooks: this isn't a git checkout, so it leaves the hooks alone.");
	process.exit(0);
}
execFileSync("git", ["config", "core.hooksPath", fileURLToPath(new URL("../hooks", import.meta.url))]);
