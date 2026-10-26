#!/usr/bin/env node
// The net source lines and the declared steps of the change git holds staged, which the prepare-commit-msg hook appends to a commit's message.
import { execFileSync } from "node:child_process";
import { commitSummary } from "@haibun/core/lib/test/commit-summary.js";

const STEPS_BASELINE = "scripts/steps.baseline.json";
const git = (...args) => execFileSync("git", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
/** A file as a revision holds it, or undefined where the revision doesn't hold it. */
const held = (revision) => {
	try {
		return git("show", `${revision}:${STEPS_BASELINE}`);
	} catch {
		return undefined;
	}
};
process.stdout.write(commitSummary(git("diff", "--cached", "--numstat"), held("HEAD"), held("")));
