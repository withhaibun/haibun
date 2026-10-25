/** The test groups of this repository state their options in their configs and hold their actualities with the code they measure,
 *  and its first-read documents name paths it holds. */
import { describe, expect, it } from "vitest";
import { brokenPaths, linksAndParentPaths, moduleOptionAssignments, testGroupDirectories, untrackedRecords } from "@haibun/core/lib/test/group-rules.js";
import { REPOSITORY } from "./roots.js";
import { SERVICE_BASES } from "./service-features.mjs";

/** The documents a contributor reads first, by their paths from the repository root. */
const FIRST_READ = ["README.md", "AGENTS.md", "CLAUDE.md", "docs/architecture.md", "docs/develop_haibun.md"];
/** The package.json files of the test groups. */
const GROUP_PACKAGES = ["package.json", "e2e-tests/package.json", "modules/shu/package.json"];
const described = (found: { file: string; finding: string }[]): string[] => found.map(({ file, finding }) => `${file} ${finding}`);

describe("the groups and first-read documents of this repository", () => {
	it("leaves every module option out of a script that calls haibun-cli, so the group's config.json moduleOptions hold them (TX9)", () => {
		expect(described(moduleOptionAssignments(REPOSITORY, GROUP_PACKAGES)), "move each option to the moduleOptions of the config its script names").toEqual([]);
	});

	it("doesn't commit a symbolic link, or name a parent path in a group's config, a package's script or a feature's import of a package's code", () => {
		expect(described(linksAndParentPaths(REPOSITORY)), "name what the path names by its package, or move it into the group").toEqual([]);
	});

	it("tracks the actualities file of every group a test script or the service check runs, and of each instance under it, and every baseline", () => {
		const groups = [...testGroupDirectories(REPOSITORY, GROUP_PACKAGES), ...Object.values(SERVICE_BASES)];
		expect(groups, "the test scripts name the groups").toContain("modules/shu/tests");
		expect(described(untrackedRecords(REPOSITORY, groups)), "commit each file with the code it measures").toEqual([]);
	});

	it("names only paths that the repository holds (TX13)", () => {
		expect(described(brokenPaths(REPOSITORY, FIRST_READ)), "correct each path or remove it").toEqual([]);
	});
});
