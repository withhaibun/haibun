/**
 * A repository's prose findings: the violations of the Writing rules under its roots, each by its file, rule and line,
 * apart from the entries its allowance file holds. A path git ignores isn't read.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TFound } from "./baseline.js";
import { allowanceFrom, proseViolations } from "./prose-rules.js";
import { gitIgnored } from "./repository-files.js";

/** What a repository's prose check reads: its roots and the paths it excludes, from the repository root, and its allowance file. */
type TProseScope = { roots: readonly string[]; exclude: readonly RegExp[]; allowedFile: string };

export function proseFindings(repository: string, { roots, exclude, allowedFile }: TProseScope): TFound[] {
	const allowance = allowanceFrom(JSON.parse(readFileSync(allowedFile, "utf-8")), allowedFile);
	const files = proseViolations(
		roots.map((root) => join(repository, root)),
		{ exclude: [...exclude, ...gitIgnored(repository, roots)], allowance },
	);
	return files.flatMap(({ path, violations }) => violations.map(({ rule, line }) => ({ file: path, finding: rule, line })));
}
