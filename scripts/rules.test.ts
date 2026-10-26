/** This repository held to the rules every repository built on haibun holds itself to, which core's rule suite states. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describeRepositoryRules } from "@haibun/core/lib/test/repository-rules.js";
import { sourceDirectoryOf, workspacePackages } from "@haibun/core/lib/test/repository-files.js";
import { groupPorts } from "@haibun/cli/adapters/groups.js";
import { fileSystem } from "@haibun/cli/adapters/processes.js";
import { foundGroups } from "@haibun/cli/pipelines/groups.js";

const REPOSITORY = join(import.meta.dirname, "..");
const MODULES = "modules";
/** A module's feature directories: its test groups, and the backgrounds of the waypoints it holds for other groups. */
const FEATURES = /^(tests|waypoints)/;
const directoriesIn = (path: string): string[] =>
	readdirSync(join(REPOSITORY, path), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
const modules = directoriesIn(MODULES);
const packages = workspacePackages(REPOSITORY, MODULES);
const sources = Object.values(packages).map(sourceDirectoryOf).sort();
const waypoints = modules.filter((name) => directoriesIn(join(MODULES, name)).includes("waypoints")).map((name) => `${MODULES}/${name}/waypoints`);
const features = modules.flatMap((name) =>
	directoriesIn(join(MODULES, name))
		.filter((entry) => FEATURES.test(entry))
		.map((entry) => `${MODULES}/${name}/${entry}`),
);

describeRepositoryRules({
	repository: REPOSITORY,
	testFile: "scripts/rules.test.ts",
	baselines: import.meta.dirname,
	codeRoots: [...sources, ...waypoints, "scripts", `${MODULES}/*/scripts/*`],
	codeSamples: [
		"modules/core/src/lib/domains/util.ts",
		"modules/shu/src/page/components/shu-element.ts",
		"modules/shu/waypoints/backgrounds/views.feature.ts",
		"modules/shu/scripts/bundles.ts",
	],
	packages,
	stepperRoots: sources,
	inputSelections: {
		"InstanceStepper.startRun": "matching names the features a run starts, a selection of its input",
		"TestRunnerStepper.runTest": "matching names the features a test run runs, a selection of its input",
		"WebPlaywright.requestsMatching": "matching names the requests a route writes their state for",
	},
	prose: { roots: [...sources, ...features, "e2e-tests", "docs", "scripts"], exclude: [] },
	vocabularyTable: "docs/architecture.md",
	downstreamNames: ["spopg", "muskeg", "Triton"],
	groups: () => foundGroups(REPOSITORY, groupPorts(REPOSITORY).files(), fileSystem),
	groupSample: "modules/shu/tests",
	firstRead: ["README.md", "AGENTS.md", "CLAUDE.md", "docs/architecture.md", "docs/develop_haibun.md"],
});
