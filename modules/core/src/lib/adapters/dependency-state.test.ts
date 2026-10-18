// Tests moduleRootOf, dependencyRoots and dependencyState. Most cases create a temporary git repository, so their
// results don't depend on this workspace's files.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { ACTUALITIES_FILE, dependencyRoots, dependencyState, moduleRootOf } from "./dependency-state.js";

/** Creates a temporary git repository with the given files and returns its real path. The files aren't committed,
 *  because the state is read from the working tree. */
function aRepository(files: Record<string, string>): string {
	const dir = nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-state-"));
	execFileSync("git", ["init", "-q"], { cwd: dir });
	for (const [file, content] of Object.entries(files)) {
		nodeFS.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		nodeFS.writeFileSync(path.join(dir, file), content);
	}
	return nodeFS.realpathSync(dir);
}

describe("the state of a group's dependencies", () => {
	it("is the same for the same content, and differs when a file's content changes", () => {
		const repo = aRepository({ "features/a.feature": "Feature: a\n", ".gitignore": "capture\n" });
		const before = dependencyState([repo]);
		expect(dependencyState([repo])).toBe(before);
		nodeFS.writeFileSync(path.join(repo, "features/a.feature"), "Feature: a, changed\n");
		expect(dependencyState([repo])).not.toBe(before);
	});

	it("is the same for the same repositories checked out at other directories, in either order of their roots", () => {
		const files = (name: string) => ({ [`${name}/features/a.feature`]: `Feature: ${name}\n` });
		const [first, second] = [aRepository({ ...files("one"), ...files("two") }), aRepository({ ...files("one"), ...files("two") })];
		const roots = (repo: string) => [path.join(repo, "one"), path.join(repo, "two")];
		expect(dependencyState(roots(first))).toBe(dependencyState(roots(second)));
		expect(dependencyState(roots(first)), "the roots in another order").toBe(dependencyState(roots(second).reverse()));
	});

	it("includes a file the repository would track, whether or not it is committed", () => {
		const repo = aRepository({ "features/a.feature": "Feature: a\n" });
		const before = dependencyState([repo]);
		nodeFS.writeFileSync(path.join(repo, "features/b.feature"), "Feature: b\n");
		expect(dependencyState([repo])).not.toBe(before);
	});

	it("excludes the files the repository ignores, because they are derived output", () => {
		const repo = aRepository({ "features/a.feature": "Feature: a\n", ".gitignore": "capture\nbuild\n" });
		const before = dependencyState([repo]);
		nodeFS.mkdirSync(path.join(repo, "capture"));
		nodeFS.writeFileSync(path.join(repo, "capture/run.log"), "a run's output");
		nodeFS.mkdirSync(path.join(repo, "build"));
		nodeFS.writeFileSync(path.join(repo, "build/a.js"), "compiled");
		expect(dependencyState([repo])).toBe(before);
	});

	it("excludes the file an actuality writes about itself, so recording an outcome or a duration doesn't change the state", () => {
		const repo = aRepository({ "features/a.feature": "Feature: a\n" });
		const before = dependencyState([repo]);
		nodeFS.writeFileSync(path.join(repo, ACTUALITIES_FILE), "{}\n");
		expect(dependencyState([repo])).toBe(before);
	});

	it("differs when the declared environments differ, because an environment is a declared dependency", () => {
		const repo = aRepository({ "features/a.feature": "Feature: a\n" });
		expect(dependencyState([repo], ["imap"])).not.toBe(dependencyState([repo]));
		expect(dependencyState([repo], ["imap", "llm"]), "the same environments in any order").toBe(dependencyState([repo], ["llm", "imap"]));
	});

	it("is undefined for a directory that isn't in a repository, rather than the empty state", () => {
		const dir = nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-norepo-"));
		nodeFS.writeFileSync(path.join(dir, "a.feature"), "Feature: a\n");
		expect(dependencyState([dir])).toBeUndefined();
	});

	it("is undefined for an installed module whose files the repository ignores, rather than the state of an empty root", () => {
		const repo = aRepository({ ".gitignore": "node_modules\n", "node_modules/@x/m/package.json": "{}", "node_modules/@x/m/index.js": "1" });
		expect(dependencyState([path.join(repo, "node_modules/@x/m")])).toBeUndefined();
	});

	it("includes a symbolic link by its target path, so a link to a directory adds to the state rather than throwing", () => {
		const repo = aRepository({ "features/a.feature": "Feature: a\n" });
		nodeFS.mkdirSync(path.join(repo, "elsewhere"));
		nodeFS.symlinkSync("elsewhere", path.join(repo, "there"));
		const before = dependencyState([repo]);
		expect(before).toBeDefined();
		nodeFS.unlinkSync(path.join(repo, "there"));
		nodeFS.symlinkSync("features", path.join(repo, "there"));
		expect(dependencyState([repo]), "a link with another target changes the state").not.toBe(before);
	});

	it("throws when git can't run in a directory, rather than treating the failure as a missing repository", () => {
		const repo = aRepository({ "a.feature": "Feature: a\n" });
		const gone = path.join(repo, "gone");
		expect(() => dependencyState([gone])).toThrow(/git rev-parse --show-toplevel failed in/);
	});
});

describe("the dependency roots of a group", () => {
	it("returns the module directory of a path as the nearest directory that contains a package.json", () => {
		const repo = aRepository({ "package.json": "{}", "src/deep/file.ts": "" });
		expect(moduleRootOf(path.join(repo, "src/deep/file.ts"))).toBe(repo);
		expect(moduleRootOf(path.join(repo, "src"))).toBe(repo);
	});

	it("returns each base, the sources of each listed stepper's module and each dependsOn path once", () => {
		const repo = aRepository({ "package.json": "{}", "tests/config.json": "{}", "tests/features/a.feature": "Feature: a\n", "fixtures/x.json": "{}" });
		const configDir = path.join(repo, "tests");
		// `haibun` and `variables-stepper` are two steppers of the core module. A remote stepper runs in another instance.
		const roots = dependencyRoots(
			{ steppers: ["haibun-stepper", "variables-stepper", { remote: "http://elsewhere" }], dependsOn: ["../fixtures"] },
			[configDir],
			configDir,
			configDir,
		);
		const core = roots.filter((r) => r.endsWith(path.join("modules", "core", "src")));
		expect(core.length, "the core module's sources once for its two steppers").toBe(1);
		expect(roots).toContain(configDir);
		expect(roots).toContain(path.join(repo, "fixtures"));
		expect(roots, "in sorted order").toEqual([...roots].sort());
	});

	it("resolves a stepper named by a relative path against the working directory, and resolves a link to its real path", () => {
		const repo = aRepository({ "package.json": "{}", "build/x-stepper.js": "", "tests/config.json": "{}" });
		nodeFS.symlinkSync("build", path.join(repo, "linked"));
		const configDir = path.join(repo, "tests");
		const fromTests = dependencyRoots({ steppers: ["../linked/x-stepper"] }, [configDir], configDir, configDir);
		const fromRepo = dependencyRoots({ steppers: ["./linked/x-stepper"] }, [configDir], configDir, repo);
		expect(fromTests).toEqual(fromRepo);
		expect(fromTests).toContain(repo);
	});

	it("returns the rootDir a module's tsconfig.json declares, so a change to a document outside it doesn't change the state", () => {
		const repo = aRepository({
			"package.json": "{}",
			"tsconfig.json": JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "build" } }),
			"src/x-stepper.ts": "",
			"docs/readme.md": "",
			"tests/config.json": "{}",
			".gitignore": "build\n",
		});
		nodeFS.mkdirSync(path.join(repo, "build"));
		nodeFS.writeFileSync(path.join(repo, "build/x-stepper.js"), "");
		const configDir = path.join(repo, "tests");
		const roots = dependencyRoots({ steppers: ["../build/x-stepper"] }, [configDir], configDir, configDir);
		expect(roots).toContain(path.join(repo, "src"));
		expect(roots, "the whole module isn't a root").not.toContain(repo);
		const before = dependencyState(roots);
		nodeFS.writeFileSync(path.join(repo, "docs/readme.md"), "changed");
		expect(dependencyState(roots), "a document outside rootDir doesn't change the state").toBe(before);
		nodeFS.writeFileSync(path.join(repo, "src/x-stepper.ts"), "changed");
		expect(dependencyState(roots), "a source under rootDir changes the state").not.toBe(before);
	});

	it("throws when a module's tsconfig.json can't be read as JSON, rather than depending on the whole module", () => {
		const repo = aRepository({ "package.json": "{}", "tsconfig.json": "{ not json", "build/x-stepper.js": "", "tests/config.json": "{}" });
		const configDir = path.join(repo, "tests");
		expect(() => dependencyRoots({ steppers: ["../build/x-stepper"] }, [configDir], configDir, configDir)).toThrow(/tsconfig\.json could not be read/);
	});

	it("throws for a dependsOn path that doesn't exist, rather than verifying without it", () => {
		const repo = aRepository({ "tests/config.json": "{}" });
		const configDir = path.join(repo, "tests");
		expect(() => dependencyRoots({ steppers: [], dependsOn: ["../fixtures"] }, [configDir], configDir, configDir)).toThrow(/dependsOn names \.\.\/fixtures/);
	});
});
