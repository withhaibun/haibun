import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { linksAndParentPaths, optionAssignments, untrackedRecords } from "./group-rules.js";

describe("the parent paths and tracking files of a repository's groups", () => {
	let repository = "";
	const committed = (files: Record<string, string>) => {
		for (const [file, text] of Object.entries(files)) {
			mkdirSync(dirname(join(repository, file)), { recursive: true });
			writeFileSync(join(repository, file), text);
		}
		execFileSync("git", ["add", "."], { cwd: repository });
	};
	beforeEach(() => {
		repository = mkdtempSync(join(tmpdir(), "haibun-group-rules-"));
		execFileSync("git", ["init", "-q"], { cwd: repository });
	});
	afterEach(() => rmSync(repository, { recursive: true, force: true }));

	it("find a feature's import of a package's code by a parent path, apart from the group's own backgrounds and a test", () => {
		committed({
			"service/features/serve.feature.ts": 'import { GraphStepper } from "../../build/graph/graph-stepper.js";\nimport { gate } from "../backgrounds/gate.ts";\n',
			"service/backgrounds/gate.ts": 'import { listed } from "../../src/domains/listed.ts";\n',
			"service/features/serve.integration.test.ts": 'import { GraphStepper } from "../../build/graph/graph-stepper.js";\n',
			"src/web/features/page.ts": 'import { listed } from "../../domains/listed.js";\n',
		});
		expect(linksAndParentPaths(repository)).toEqual([
			{ file: "service/backgrounds/gate.ts", finding: "imports ../../src/domains/listed.ts, a package's code, by a parent path" },
			{ file: "service/features/serve.feature.ts", finding: "imports ../../build/graph/graph-stepper.js, a package's code, by a parent path" },
		]);
	});

	it("find a relative path of code or of a config that names a place outside the repository, a package it ignores, or a folder through a link, and not its own build", () => {
		committed({
			".gitignore": "/other\n/linked\nbuild\nnode_modules\n",
			"other/package.json": "{}",
			"vitest.config.ts": 'import { preset } from "./other/preset.js";\nimport { own } from "./src/own.js";\n',
			"bin/run.js": 'import "../build/run.js";\nimport "../node_modules/tool/run.js";\n',
			"node_modules/tool/package.json": "{}",
			"biome.json": '{ "extends": ["../shared/biome.json"], "files": { "includes": ["**"] } }',
			"tsconfig.json": '{\n\t// a comment, as a tsconfig allows\n\t"extends": "./tsconfig.base.json"\n}',
			"src/own.ts": "export const own = 1;\n",
		});
		symlinkSync(tmpdir(), join(repository, "linked"));
		committed({ "scripts/bundles.ts": 'import { run } from "../linked/bundles.ts";\n' });
		expect(linksAndParentPaths(repository)).toEqual([
			{ file: "scripts/bundles.ts", finding: "imports ../linked/bundles.ts, which the repository doesn't hold: name it by its package" },
			{ file: "vitest.config.ts", finding: "imports ./other/preset.js, which the repository doesn't hold: name it by its package" },
			{ file: "bin/run.js", finding: "imports ../node_modules/tool/run.js, which the repository doesn't hold: name it by its package" },
			{ file: "biome.json", finding: "names ../shared/biome.json, which the repository doesn't hold: name it by its package" },
		]);
	});

	it("find an untracked or ignored actualities file of a group or an instance under it that doesn't need an environment, and an untracked or ignored baseline outside an ignored directory", () => {
		const group = { steppers: [] };
		committed({
			"e2e/p/config.json": JSON.stringify(group),
			"e2e/p/actualities.json": "{}\n",
			"e2e/t/config.json": JSON.stringify(group),
			"e2e/t/peer/config.json": JSON.stringify(group),
			"e2e/t/peer/actualities.json": "{}\n",
			"e2e/t/staging/config.json": JSON.stringify({ ...group, environments: ["staging"] }),
			".gitignore": "e2e/t/peer/actualities.json\nscripts/old.baseline.json\nnode_modules\n",
			"scripts/steps.baseline.json": "{}\n",
		});
		writeFileSync(join(repository, "scripts/prose.baseline.json"), "{}\n");
		writeFileSync(join(repository, "scripts/old.baseline.json"), "{}\n");
		// An installed package's baseline is in an ignored directory, which the listing doesn't enter.
		mkdirSync(join(repository, "node_modules/p"), { recursive: true });
		writeFileSync(join(repository, "node_modules/p/x.baseline.json"), "{}\n");
		expect(untrackedRecords(repository, ["e2e/p", "e2e/t"])).toEqual([
			{ file: "e2e/t/actualities.json", finding: "isn't tracked: run its group, or its rule test, and commit the file with the code it measures" },
			{ file: "e2e/t/peer/actualities.json", finding: "isn't tracked: run its group, or its rule test, and commit the file with the code it measures" },
			{ file: "e2e/t/peer/actualities.json", finding: "is ignored by a .gitignore entry: remove the entry, so a commit holds the file" },
			{ file: "scripts/prose.baseline.json", finding: "isn't tracked: run its group, or its rule test, and commit the file with the code it measures" },
			{ file: "scripts/old.baseline.json", finding: "isn't tracked: run its group, or its rule test, and commit the file with the code it measures" },
			{ file: "scripts/old.baseline.json", finding: "is ignored by a .gitignore entry: remove the entry, so a commit holds the file" },
		]);
	});

	it("find an option a script assigns, and a script that names a path in another package", () => {
		committed({
			"package.json": JSON.stringify({ scripts: { test: "HAIBUN_ENV=a=b haibun-cli --groups", start: "haibun-cli -c other/config.json other", own: "node scripts/run.ts" } }),
			"scripts/run.ts": "",
			"other/package.json": "{}",
			"other/config.json": JSON.stringify({ steppers: [] }),
		});
		expect(optionAssignments(repository)).toEqual([{ file: "package.json", finding: "script test states HAIBUN_ENV" }]);
		expect(linksAndParentPaths(repository)).toEqual([
			{ file: "package.json", finding: "script start names other/config.json, a path in another package" },
			{ file: "package.json", finding: "script start names other, a path in another package" },
		]);
	});
});
