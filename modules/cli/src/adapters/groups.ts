/**
 * What `haibun-cli --groups` reads and starts in a repository: its files, as git lists them, and a group's run, the built cli started
 * from the config's directory with the output of this process.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import type { TGroup } from "../domains/groups.js";
import type { TGroups } from "../ports.js";

/** The option that names the config a run reads. */
const CONFIG_OPTION = "--config";

/** The tracked files of a repository that its working tree holds, and those it doesn't ignore, by their paths from `root`. Throws where
 *  git doesn't list them, naming the remedy. */
function repositoryFiles(root: string): string[] {
	let listed: string[];
	try {
		listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf-8" }).split("\0");
	} catch (e) {
		throw new Error(`groups: git doesn't list the files of ${root}: ${errorDetail(e)}. Find the groups in a git checkout.`);
	}
	return listed.filter((file) => file !== "" && existsSync(path.join(root, file)));
}

/** Removes a path a group clears, which names a place in its config's directory. Throws for a path outside it. */
function clear(dir: string, group: TGroup, cleared: string): void {
	const at = path.resolve(dir, cleared);
	if (path.isAbsolute(cleared) || path.relative(dir, at).startsWith("..")) throw new Error(`${group.config} clears ${cleared}, outside its directory. Name a path in ${dir}.`);
	rmSync(at, { recursive: true, force: true });
}

/** Runs a group: it clears what the group clears, then starts the cli from the config's directory with the config, the bases and the
 *  filter, and the options the command line gave, and returns its exit code. */
function runGroup(root: string, group: TGroup, args: string[]): Promise<number> {
	const dir = path.dirname(path.join(root, group.config));
	for (const cleared of group.clears) clear(dir, group, cleared);
	const cli = createRequire(import.meta.url).resolve("@haibun/cli");
	const filter = group.filter.length === 0 ? [] : [group.filter.join(",")];
	const child = spawn(process.execPath, [cli, CONFIG_OPTION, path.basename(group.config), group.bases.join(","), ...filter, ...args], { cwd: dir, stdio: "inherit" });
	return new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("exit", (code, signal) => (code === null ? reject(new Error(`groups: ${group.config} ended on ${signal}`)) : resolve(code)));
	});
}

/** The groups of features of the repository at `root`: its files, by their paths from `root`, and a group's run. */
export const groupPorts = (root: string): TGroups => ({ files: () => repositoryFiles(root), run: (group, args) => runGroup(root, group, args) });
