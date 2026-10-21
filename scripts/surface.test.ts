/**
 * This repository held to three rules of the logic engine. Only the engine's prover reaches step dispatch or a step's
 * action, so every surface has one path. Only the engine's reader reads the store, so a proof reads state one way. One term
 * names each concept, and a synonym the vocabulary table of docs/architecture.md removes is counted where it is used. A file
 * holds each finding at most as often as its baseline records.
 */
import { join } from "node:path";
import { describe, it } from "vitest";
import { expectWithinBaseline, REPOSITORY_SCAN_MS } from "@haibun/core/lib/test/baseline.js";
import { parsedSources, sourceFiles } from "@haibun/core/lib/test/repository-files.js";
import { gitIgnored } from "@haibun/core/lib/test/repository-files.js";
import { oneReadFindings, onePathFindings, vocabularyFindings } from "@haibun/core/lib/test/surface-rules.js";
import { MODULE_SOURCES, PROSE_ROOTS, REPOSITORY } from "./roots.js";

const TEST_FILE = "scripts/surface.test.ts";

describe("the surfaces and the vocabulary of this repository", () => {
	it(
		"reaches step dispatch and a step's action only through the logic engine's prover, apart from what one-path.baseline.json records",
		() => {
			const found = onePathFindings(parsedSources(REPOSITORY, sourceFiles(REPOSITORY, MODULE_SOURCES)));
			const fix = "prove the step through proveStep, which dispatches each call of its proof";
			expectWithinBaseline({ baselineFile: join(import.meta.dirname, "one-path.baseline.json"), found, testFile: TEST_FILE, fix });
		},
		REPOSITORY_SCAN_MS,
	);

	it(
		"reads the store in the logic engine only through its reader, apart from what one-read.baseline.json records",
		() => {
			const found = oneReadFindings(parsedSources(REPOSITORY, sourceFiles(REPOSITORY, MODULE_SOURCES)));
			const fix = "read the store through readerOf in modules/logic/src/pipelines/reads.ts, which answers the engine's read request";
			expectWithinBaseline({ baselineFile: join(import.meta.dirname, "one-read.baseline.json"), found, testFile: TEST_FILE, fix });
		},
		REPOSITORY_SCAN_MS,
	);

	it(
		"names each concept by its term, apart from what vocabulary.baseline.json records",
		() => {
			const found = vocabularyFindings(REPOSITORY, PROSE_ROOTS, "docs/architecture.md", gitIgnored(REPOSITORY, PROSE_ROOTS));
			const fix = "name the concept by the term the vocabulary table of docs/architecture.md states";
			expectWithinBaseline({ baselineFile: join(import.meta.dirname, "vocabulary.baseline.json"), found, testFile: TEST_FILE, fix });
		},
		REPOSITORY_SCAN_MS,
	);
});
