/**
 * This repository's prose held to the Writing rules that core's prose check detects. A file breaks each rule at most as
 * often as `prose.baseline.json` records, apart from the text `prose.allowed.json` allows with its reason.
 */
import { join } from "node:path";
import { describe, it } from "vitest";
import { expectWithinBaseline } from "@haibun/core/lib/test/baseline.js";
import { proseFindings } from "@haibun/core/lib/test/prose-baseline.js";
import { PROSE_ROOTS, REPOSITORY, REPOSITORY_SCAN_MS } from "./roots.js";

const FIX = "rewrite the prose, or allow its text in prose.allowed.json with the reason it doesn't break the rule";

describe("the prose of this repository", () => {
	it(
		"breaks each rule at most as often as its baseline records",
		() => {
			const found = proseFindings(REPOSITORY, { roots: PROSE_ROOTS, exclude: [], allowedFile: join(import.meta.dirname, "prose.allowed.json") });
			expectWithinBaseline({ baselineFile: join(import.meta.dirname, "prose.baseline.json"), found, testFile: "scripts/prose.test.ts", fix: FIX });
		},
		REPOSITORY_SCAN_MS,
	);
});
