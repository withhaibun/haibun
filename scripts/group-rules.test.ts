/** The test groups of this repository state their options in their configs and hold their actualities with the code they measure,
 *  and its first-read documents name paths it holds. */
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { brokenPaths, linksAndParentPaths, optionAssignments, untrackedRecords } from "@haibun/core/lib/test/group-rules.js";
import { groupPorts } from "@haibun/cli/adapters/groups.js";
import { foundGroups } from "@haibun/cli/pipelines/groups.js";
import { fileSystem } from "@haibun/cli/adapters/processes.js";
import { REPOSITORY } from "./roots.js";

/** The documents a contributor reads first, by their paths from the repository root. */
const FIRST_READ = ["README.md", "AGENTS.md", "CLAUDE.md", "docs/architecture.md", "docs/develop_haibun.md"];
const described = (found: { file: string; finding: string }[]): string[] => found.map(({ file, finding }) => `${file} ${finding}`);

describe("the groups and first-read documents of this repository", () => {
	it("leaves every option of haibun out of a script, so the config the script's command reads holds it (TX9)", () => {
		expect(described(optionAssignments(REPOSITORY)), "move each option to the options or moduleOptions of the config the script's command reads").toEqual([]);
	});

	it("doesn't commit a symbolic link, or name a parent path in a group's config, a package's script or a feature's import of a package's code", () => {
		expect(described(linksAndParentPaths(REPOSITORY)), "name what the path names by its package, or move it into the group").toEqual([]);
	});

	it("tracks the actualities file of every group, and of each instance under it, and every baseline", () => {
		const groups = [...new Set(foundGroups(REPOSITORY, groupPorts(REPOSITORY).files(), fileSystem).map(({ config }) => dirname(config)))];
		expect(groups, "the configs declare the groups").toContain("modules/shu/tests");
		expect(described(untrackedRecords(REPOSITORY, groups)), "commit each file with the code it measures").toEqual([]);
	});

	it("names only paths that the repository holds (TX13)", () => {
		expect(described(brokenPaths(REPOSITORY, FIRST_READ)), "correct each path or remove it").toEqual([]);
	});
});
