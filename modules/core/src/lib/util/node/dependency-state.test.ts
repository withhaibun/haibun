// What a run of features depends on, and the state of it. A repository is made here for each case, so what is stated
// is the rule over content rather than over this workspace's files.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { TIMINGS_FILE, VERIFIED_FILE, dependencyRoots, dependencyState, moduleRootOf } from "./dependency-state.js";

/** A repository holding the files given, with nothing committed: the state is read from the working tree. */
function aRepository(files: Record<string, string>): string {
	const dir = nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-state-"));
	execFileSync("git", ["init", "-q"], { cwd: dir });
	for (const [file, content] of Object.entries(files)) {
		nodeFS.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		nodeFS.writeFileSync(path.join(dir, file), content);
	}
	return nodeFS.realpathSync(dir);
}

describe("the state of what a run depends on", () => {
	it("is the same for the same content, and differs when a file's content changes", () => {
		const repo = aRepository({ "features/a.feature": "Feature: a\n", ".gitignore": "capture\n" });
		const before = dependencyState([repo]);
		expect(dependencyState([repo])).toBe(before);
		nodeFS.writeFileSync(path.join(repo, "features/a.feature"), "Feature: a, changed\n");
		expect(dependencyState([repo])).not.toBe(before);
	});

	it("takes in a file the repository would track, whether or not it is committed yet", () => {
		const repo = aRepository({ "features/a.feature": "Feature: a\n" });
		const before = dependencyState([repo]);
		nodeFS.writeFileSync(path.join(repo, "features/b.feature"), "Feature: b\n");
		expect(dependencyState([repo])).not.toBe(before);
	});

	it("leaves out what the repository ignores, since that is derived output", () => {
		const repo = aRepository({ "features/a.feature": "Feature: a\n", ".gitignore": "capture\nbuild\n" });
		const before = dependencyState([repo]);
		nodeFS.mkdirSync(path.join(repo, "capture"));
		nodeFS.writeFileSync(path.join(repo, "capture/run.log"), "a run's output");
		nodeFS.mkdirSync(path.join(repo, "build"));
		nodeFS.writeFileSync(path.join(repo, "build/a.js"), "compiled");
		expect(dependencyState([repo])).toBe(before);
	});

	it("leaves out what a run writes about itself, so recording a pass or a timing does not change what was passed against", () => {
		const repo = aRepository({ "features/a.feature": "Feature: a\n" });
		const before = dependencyState([repo]);
		nodeFS.writeFileSync(path.join(repo, VERIFIED_FILE), "{}\n");
		nodeFS.writeFileSync(path.join(repo, TIMINGS_FILE), "{}\n");
		expect(dependencyState([repo])).toBe(before);
	});

	it("differs when the environments declared differ, since an environment is a dependency by declaration", () => {
		const repo = aRepository({ "features/a.feature": "Feature: a\n" });
		expect(dependencyState([repo], ["imap"])).not.toBe(dependencyState([repo]));
		expect(dependencyState([repo], ["imap", "llm"]), "in whatever order they are named").toBe(dependencyState([repo], ["llm", "imap"]));
	});

	it("is unknown for a directory in no repository, rather than the state of nothing", () => {
		const dir = nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-norepo-"));
		nodeFS.writeFileSync(path.join(dir, "a.feature"), "Feature: a\n");
		expect(dependencyState([dir])).toBeUndefined();
	});

	it("is unknown for a root whose files the repository ignores, as an installed module's are, rather than the state of an empty one", () => {
		const repo = aRepository({ ".gitignore": "node_modules\n", "node_modules/@x/m/package.json": "{}", "node_modules/@x/m/index.js": "1" });
		expect(dependencyState([path.join(repo, "node_modules/@x/m")])).toBeUndefined();
	});

	it("takes a link by what it points at, so a tracked link to a directory is part of the state rather than a failure", () => {
		const repo = aRepository({ "features/a.feature": "Feature: a\n" });
		nodeFS.mkdirSync(path.join(repo, "elsewhere"));
		nodeFS.symlinkSync("elsewhere", path.join(repo, "there"));
		const before = dependencyState([repo]);
		expect(before).toBeDefined();
		nodeFS.unlinkSync(path.join(repo, "there"));
		nodeFS.symlinkSync("features", path.join(repo, "there"));
		expect(dependencyState([repo]), "the link points elsewhere, which is a change").not.toBe(before);
	});

	it("says so when git cannot be asked, rather than treating the failure as no repository", () => {
		const repo = aRepository({ "a.feature": "Feature: a\n" });
		const gone = path.join(repo, "gone");
		expect(() => dependencyState([gone])).toThrow(/could not ask git about/);
	});
});

describe("what a run depends on", () => {
	it("names the module a path belongs to, which is the nearest directory holding a package.json", () => {
		const repo = aRepository({ "package.json": "{}", "src/deep/file.ts": "" });
		expect(moduleRootOf(path.join(repo, "src/deep/file.ts"))).toBe(repo);
		expect(moduleRootOf(path.join(repo, "src"))).toBe(repo);
	});

	it("derives the bases, the module of every stepper named, and the paths the configuration adds, each once", () => {
		const repo = aRepository({ "package.json": "{}", "tests/config.json": "{}", "tests/features/a.feature": "Feature: a\n", "fixtures/x.json": "{}" });
		const configDir = path.join(repo, "tests");
		// `haibun` and `variables-stepper` are two steppers of one module, the core; a remote stepper is another instance's.
		const roots = dependencyRoots({ steppers: ["haibun", "variables-stepper", { remote: "http://elsewhere" }], dependsOn: ["../fixtures"] }, [configDir], configDir, configDir);
		const core = roots.filter((r) => r.endsWith(path.join("modules", "core", "src")));
		expect(core.length, "the core's sources once, for its two steppers").toBe(1);
		expect(roots).toContain(configDir);
		expect(roots).toContain(path.join(repo, "fixtures"));
		expect(roots, "in a stable order").toEqual([...roots].sort());
	});

	it("resolves a stepper named by a relative path from the directory the run is made from, and through a link to where it is", () => {
		const repo = aRepository({ "package.json": "{}", "build/x-stepper.js": "", "tests/config.json": "{}" });
		nodeFS.symlinkSync("build", path.join(repo, "linked"));
		const configDir = path.join(repo, "tests");
		const fromTests = dependencyRoots({ steppers: ["../linked/x-stepper"] }, [configDir], configDir, configDir);
		const fromRepo = dependencyRoots({ steppers: ["./linked/x-stepper"] }, [configDir], configDir, repo);
		expect(fromTests).toEqual(fromRepo);
		expect(fromTests).toContain(repo);
	});

	it("takes a module built from a directory its own build configuration declares as that directory, so its tests, documents and groups are not what its stepper reaches", () => {
		const repo = aRepository({ "package.json": "{}", "tsconfig.json": JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "build" } }), "src/x-stepper.ts": "", "docs/readme.md": "", "tests/config.json": "{}", ".gitignore": "build\n" });
		nodeFS.mkdirSync(path.join(repo, "build"));
		nodeFS.writeFileSync(path.join(repo, "build/x-stepper.js"), "");
		const configDir = path.join(repo, "tests");
		const roots = dependencyRoots({ steppers: ["../build/x-stepper"] }, [configDir], configDir, configDir);
		expect(roots).toContain(path.join(repo, "src"));
		expect(roots, "the module whole is not among them").not.toContain(repo);
		const before = dependencyState(roots);
		nodeFS.writeFileSync(path.join(repo, "docs/readme.md"), "changed");
		expect(dependencyState(roots), "a document is not what the stepper runs").toBe(before);
		nodeFS.writeFileSync(path.join(repo, "src/x-stepper.ts"), "changed");
		expect(dependencyState(roots), "a source is").not.toBe(before);
	});

	it("says so when a module's build configuration cannot be read, rather than guessing what the module is built from", () => {
		const repo = aRepository({ "package.json": "{}", "tsconfig.json": "{ not json", "build/x-stepper.js": "", "tests/config.json": "{}" });
		const configDir = path.join(repo, "tests");
		expect(() => dependencyRoots({ steppers: ["../build/x-stepper"] }, [configDir], configDir, configDir)).toThrow(/tsconfig\.json could not be read/);
	});

	it("refuses a dependsOn path that is not there, rather than verifying against nothing without a word", () => {
		const repo = aRepository({ "tests/config.json": "{}" });
		const configDir = path.join(repo, "tests");
		expect(() => dependencyRoots({ steppers: [], dependsOn: ["../fixtures"] }, [configDir], configDir, configDir)).toThrow(/dependsOn names \.\.\/fixtures/);
	});
});
