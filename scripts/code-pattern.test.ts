/**
 * This repository's source held to three rules of docs/architecture.md, "How code is organized". Each file is one kind of
 * code in its kind's position, and imports only the kinds its row lists (CR1). Each refusal states its cause and carries
 * its remedy as data where a caller can act on it (CR5). A value that is absent is refused or read as absent by name, and
 * isn't replaced with a default (CR8). A file holds each finding at most as often as the rule's baseline
 * file records.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectWithinBaseline } from "@haibun/core/lib/test/baseline.js";
import { codeKindFindings, UNPOSITIONED } from "@haibun/core/lib/test/code-kinds.js";
import { composeFiles, defaultFindings } from "@haibun/core/lib/test/default-rules.js";
import { refusalFindings } from "@haibun/core/lib/test/refusal-rules.js";
import { sourceFiles } from "@haibun/core/lib/test/repository-files.js";
import { MODULE_PACKAGES, MODULE_SOURCES, REPOSITORY } from "./roots.js";

const TEST_FILE = "scripts/code-pattern.test.ts";
const files = sourceFiles(REPOSITORY, MODULE_SOURCES);

describe("the source of this repository", () => {
	it("reads every module's source", () => {
		expect(files).toEqual(expect.arrayContaining(["modules/core/src/lib/util/index.ts", "modules/shu/src/components/shu-element.ts"]));
	});

	it("places each file in a kind position that imports only its row's kinds, apart from what code-kinds.baseline.json records (CR1)", () => {
		const found = codeKindFindings(REPOSITORY, { files, packages: MODULE_PACKAGES });
		const fix = `move a file that ${UNPOSITIONED} into its kind's directory, and import only the kinds its row of docs/architecture.md lists`;
		expectWithinBaseline({ baselineFile: join(import.meta.dirname, "code-kinds.baseline.json"), found, testFile: TEST_FILE, fix });
	});

	it("states each refusal's cause and carries a remedy a caller can act on, apart from what refusals.baseline.json records (CR5)", () => {
		const fix = "state what failed and why in the refusal's own words, and carry the remedy a caller can act on as data";
		expectWithinBaseline({ baselineFile: join(import.meta.dirname, "refusals.baseline.json"), found: refusalFindings(REPOSITORY, files), testFile: TEST_FILE, fix });
	});

	it("doesn't state a default value, apart from what defaults.baseline.json records (CR8)", () => {
		const fix = "refuse the absent value with a message that names what supplies it, or type it as optional and read its absence by name";
		const found = defaultFindings(REPOSITORY, files, composeFiles(REPOSITORY));
		expectWithinBaseline({ baselineFile: join(import.meta.dirname, "defaults.baseline.json"), found, testFile: TEST_FILE, fix });
	});
});
