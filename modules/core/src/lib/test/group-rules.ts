/**
 * Rules for the test groups of a repository and for its first-read documents. A group states its options in its config's
 * `moduleOptions`, and its script calls `haibun-cli` without any. A group names what it uses by its package rather than by a
 * parent path or a link. A first-read document names only paths that exist.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { itemAt } from "../domains/item-at.js";
import type { TFound } from "./baseline.js";

const HAIBUN_CLI = /\bhaibun-cli\b/;
const MODULE_OPTION_ASSIGNMENT = /\bHAIBUN_O_[A-Z0-9_]+(?==)/g;
const PackageScriptsSchema = z.object({ scripts: z.record(z.string(), z.string()).optional() });
/** A markdown link's target, and a file path in backticks. */
const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;
const QUOTED_PATH = /`((?:\.{1,2}\/)?[\w-]+(?:\/[\w.-]+)+\.(?:md|json|mjs|sh|feature|ts|yml))`/g;
const NOT_A_PATH = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i;
const GENERATED = /(?:^|\/)(?:build|build-local|node_modules|capture)\//;
/** A string of a JSON file that names a path through a parent directory. */
const PARENT_PATH = /"([^"]*\.\.\/[^"]*)"/g;
/** The mode git records for a symbolic link. */
const LINK_MODE = "120000";
/** A config of a group, which lists the steppers it loads. */
const GroupConfigSchema = z.object({ steppers: z.array(z.unknown()) });

/** The files git tracks in a repository that match a pattern, by their paths from the repository root. */
export const trackedFiles = (repository: string, pattern: string): string[] =>
	execFileSync("git", ["ls-files", "--", pattern], { cwd: repository, encoding: "utf-8" }).split("\n").filter(Boolean);

/** Each `HAIBUN_O_` option that a script of one of the group package.json files, by their paths from the repository root, states
 *  before a `haibun-cli` call. */
export function moduleOptionAssignments(repository: string, groupPackages: readonly string[]): TFound[] {
	return groupPackages.flatMap((file) =>
		Object.entries(PackageScriptsSchema.parse(JSON.parse(readFileSync(join(repository, file), "utf-8"))).scripts ?? {})
			.filter(([, script]) => HAIBUN_CLI.test(script))
			.flatMap(([name, script]) => (script.match(MODULE_OPTION_ASSIGNMENT) ?? []).map((option) => ({ file, finding: `script ${name} states ${option}` }))),
	);
}

/** Each symbolic link a repository commits, each parent path that a group's config names, and each script of a package.json that
 *  names a parent path. A group names a stepper, a base config, a waypoint base and a dependency by its package, and a script calls
 *  `haibun-cli`, which npm puts on the path, so the group runs the same wherever the repository is checked out. */
export function linksAndParentPaths(repository: string): TFound[] {
	const links = execFileSync("git", ["ls-files", "-s"], { cwd: repository, encoding: "utf-8" })
		.split("\n")
		.filter((line) => line.startsWith(`${LINK_MODE} `))
		.map((line) => ({ file: itemAt(line.split("\t"), 1), finding: "is a symbolic link, which a checkout elsewhere doesn't resolve" }));
	const configs = trackedFiles(repository, ":(glob)**/config*.json").flatMap((file) => {
		const text = readFileSync(join(repository, file), "utf-8");
		if (!GroupConfigSchema.safeParse(JSON.parse(text)).success) return [];
		return [...text.matchAll(PARENT_PATH)].map((m) => ({ file, finding: `names ${itemAt(m, 1)}, a parent path` }));
	});
	const scripts = trackedFiles(repository, "*package.json").flatMap((file) =>
		Object.entries(PackageScriptsSchema.parse(JSON.parse(readFileSync(join(repository, file), "utf-8"))).scripts ?? {})
			.filter(([, script]) => script.includes("../"))
			.map(([name]) => ({ file, finding: `script ${name} names a parent path` })),
	);
	return [...links, ...configs, ...scripts];
}

/** Each relative link and each quoted path of the markdown documents, by their paths from the repository root, that names a path
 *  absent from the repository. A path resolves from its document or from the repository root. */
export function brokenPaths(repository: string, documents: readonly string[]): TFound[] {
	return documents.flatMap((document) => {
		const text = readFileSync(join(repository, document), "utf-8");
		const named = [...text.matchAll(MARKDOWN_LINK)].map((m) => itemAt(m, 1)).filter((target) => !NOT_A_PATH.test(target));
		const quoted = [...text.matchAll(QUOTED_PATH)].map((m) => itemAt(m, 1)).filter((target) => !GENERATED.test(target));
		return [...named, ...quoted]
			.map((target) => target.replace(/#.*/, ""))
			.filter((target) => target !== "")
			.filter((target) => !existsSync(resolve(repository, dirname(document), target)) && !existsSync(resolve(repository, target)))
			.map((target) => ({ file: document, finding: `names ${target}, which the repository doesn't hold` }));
	});
}
