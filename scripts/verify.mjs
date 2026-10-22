/**
 * Runs the checks that the package.json of the working directory lists under `verify`, one after another, and stops at the first
 * that fails. Each check runs with HAIBUN_ONCE, so a group of features whose last pass holds against its present dependencies is
 * not run again. It prints each check's duration and the lines the working tree changes, which a commit message states. A repository's `verify` script runs it: `node scripts/verify.mjs` here and `node haibun/scripts/verify.mjs` in spopg.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { z } from "zod";

const ChecksSchema = z.array(z.object({ check: z.string().min(1), command: z.string().min(1) })).min(1);
const { verify } = JSON.parse(readFileSync("package.json", "utf8"));
const parsed = ChecksSchema.safeParse(verify);
if (!parsed.success) {
	console.error(`verify: package.json doesn't list any checks. Add "verify": [{ "check": "lint", "command": "npm run lint" }] to it.`);
	process.exit(1);
}

const durations = [];
for (const { check, command } of parsed.data) {
	const started = Date.now();
	console.info(`\n== ${check}: ${command}`);
	const ran = spawnSync(command, { shell: true, stdio: "inherit", env: { ...process.env, HAIBUN_ONCE: "true" } });
	durations.push(`${check}: ${((Date.now() - started) / 1000).toFixed(0)} s`);
	if (ran.status !== 0) {
		console.error(`\nverify: ${check} failed (${ran.status ?? ran.signal}). Fix it, then run: ${command}\n${durations.join("\n")}`);
		process.exit(ran.status ?? 1);
	}
}
console.info(`\nverify: every check passed.\n${durations.join("\n")}`);
console.info(`lines changed: ${execFileSync("git", ["diff", "--shortstat", "HEAD"], { encoding: "utf8" }).trim() || "0 files"}`);
