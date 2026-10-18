/**
 * Rules for the test groups of a repository and for its first-read documents. A group states its options in its config's
 * `moduleOptions`, and its script calls `haibun-cli` without any. A first-read document names only paths that exist.
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
