/**
 * Points git at a versioned hooks folder, which the first argument names, so a commit runs the pre-commit check. A checkout without
 * git, such as an unpacked tarball, doesn't need hooks. A repository's `prepare` script runs it:
 * `node scripts/install-hooks.mjs .githooks` in haibun, and `node haibun/scripts/install-hooks.mjs haibun/.githooks` in spopg.
 */
import { execFileSync } from "node:child_process";

const hooks = process.argv[2];
if (hooks === undefined) {
	console.error("install-hooks: the first argument doesn't name a hooks folder. Run: node scripts/install-hooks.mjs .githooks");
	process.exit(1);
}
try {
	execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "pipe" });
} catch {
	console.info("install-hooks: this isn't a git checkout, so it leaves the hooks alone.");
	process.exit(0);
}
execFileSync("git", ["config", "core.hooksPath", hooks]);
