#!/usr/bin/env node
// Reports the prose under each root that breaks a Writing rule: a JSON report with --json, otherwise a line per violation.
// It imports the rules from @haibun/core's build, which `npm run build` or the build watcher writes. A violation sets the exit
// code to 1, and a usage error sets it to 2.
//
// Usage: node scripts/prose-report.mjs [--json] [--exclude <regex>]... [--allowed <allowed.json>] <root>...
//   --exclude  a pattern matched against a file's path from its repository root
//   --allowed  a JSON object: "entries", an array of { file, rule, text, reason }, each a violation a file holds on purpose,
//              and "persons", the names of the fixture persons the prose names as subjects
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { allowanceFrom, NO_ALLOWANCE, PROSE_RULE_IDS, proseViolations } from "../modules/core/build/lib/test/prose-rules.js";

const USAGE = "usage: node scripts/prose-report.mjs [--json] [--exclude <regex>]... [--allowed <allowed.json>] <root>...";
const VIOLATIONS_FOUND = 1;
const USAGE_ERROR = 2;
const OPTIONS = { json: { type: "boolean", default: false }, exclude: { type: "string", multiple: true, default: [] }, allowed: { type: "string" } };

function usageError(message) {
	console.error(`${message}\n${USAGE}`);
	process.exit(USAGE_ERROR);
}

const { values, positionals: roots } = (() => {
	try {
		return parseArgs({ options: OPTIONS, allowPositionals: true });
	} catch (error) {
		return usageError(error instanceof Error ? error.message : String(error));
	}
})();
if (roots.length === 0) usageError("Name at least one root to read.");

const allowance = values.allowed === undefined ? NO_ALLOWANCE : allowanceFrom(JSON.parse(readFileSync(values.allowed, "utf8")), values.allowed);
const files = proseViolations(roots, { exclude: values.exclude.map((pattern) => new RegExp(pattern)), allowance }).map(({ repository, path, violations }) => ({
	path: join(repository, path),
	count: violations.length,
	violations,
}));
const found = files.flatMap(({ violations }) => violations);
const totals = Object.fromEntries(PROSE_RULE_IDS.map((rule) => [rule, found.filter((violation) => violation.rule === rule).length]));

if (values.json) console.log(JSON.stringify({ totals, files }, null, "\t"));
else for (const { path, violations } of files) for (const { line, rule, match, text } of violations) console.log(`${path}:${line} ${rule} [${match}] ${text}`);
if (files.length > 0) process.exitCode = VIOLATIONS_FOUND;
