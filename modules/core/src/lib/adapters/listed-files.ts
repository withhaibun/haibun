/**
 * The files of a repository as git lists them: those it tracks that the working tree holds, and those it doesn't ignore. A check, a
 * rule and the group runner each read a repository through this one listing, so what git ignores is never read.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { errorDetail } from "../domains/util.js";

/** A path from the root, as git reads one: the root itself is `.`. */
const ROOT = ".";

/** The files under `paths` of the repository at `root`, by their paths from `root`, sorted. Throws where git doesn't list them, naming
 *  the remedy. */
export function listedFiles(root: string, paths: readonly string[]): string[] {
	const pathspecs = paths.map((path) => (path === "" ? ROOT : path));
	let listed: string[];
	try {
		listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...pathspecs], {
			cwd: root,
			encoding: "utf-8",
			maxBuffer: 64 * 1024 * 1024,
		}).split("\0");
	} catch (e) {
		throw new Error(`git doesn't list the files of ${root}: ${errorDetail(e)}. Read the files of a git checkout.`);
	}
	return [...new Set(listed.filter((file) => file !== "" && existsSync(join(root, file))))].sort();
}
