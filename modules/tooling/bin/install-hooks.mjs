#!/usr/bin/env node
/**
 * Points git at the hooks this package holds, so a commit in the repository that installs it runs the pre-commit check and a pull
 * links any new workspace. A checkout without git, such as an unpacked tarball, doesn't need hooks. A repository's `prepare` script
 * runs it: `haibun-install-hooks`, or, in a repository that links haibun's workspaces, `npm exec --workspace=@haibun/tooling -- node
 * bin/install-hooks.mjs`, so a missing workspace or an older haibun is named. The repository is the one npm was run in.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = process.env.INIT_CWD ?? process.cwd();
try {
	execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "pipe", cwd: repository });
} catch {
	console.info("haibun-install-hooks: this isn't a git checkout, so it leaves the hooks alone.");
	process.exit(0);
}
const hooks = fileURLToPath(new URL("../hooks", import.meta.url));
execFileSync("git", ["config", "core.hooksPath", hooks], { cwd: repository });
if (existsSync(join(repository, "haibun", ".git"))) execFileSync("git", ["-C", join(repository, "haibun"), "config", "core.hooksPath", hooks]);
