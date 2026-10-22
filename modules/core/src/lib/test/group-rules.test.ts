import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { linksAndParentPaths } from "./group-rules.js";

describe("the parent paths of a repository's groups", () => {
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
});
