import nodeFS, { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { basesFrom } from "../../domains/util.js";
import { TFileSystem } from "../../adapters/workspace-lib.js";
import { featureFiles, shouldProcess } from "./feature-files.js";

/** The files of each directory, by name. */
type TMockFiles = Record<string, Record<string, string>>;

class MockFS {
	constructor(private files: TMockFiles) {}

	existsSync(where: string) {
		return !!this.files[where];
	}
	readFileSync(where: string) {
		const e = where.split("/");
		const name = e[3];
		const content = name === undefined ? undefined : this.files[e.slice(0, 3).join("/")]?.[name];
		if (content === undefined) throw new Error(`${where} isn't a file`);
		return content;
	}
	statSync(where: string) {
		return { isDirectory: () => !!this.files[where] };
	}
	readdirSync(where: string): string[] {
		return Object.keys(this.files[where] || {});
	}
}

const nfs = (files: TMockFiles) => <TFileSystem>(new MockFS(files) as unknown);

describe("the feature files of a file system", () => {
	// A base must offer features. Every refusal below is the same claim: given bases that don't hold a feature are an error,
	// whether the directory is missing, empty, or holds backgrounds alone.
	const feature = (base: string, dir: "features" | "backgrounds", name: string) => ({ base, path: `/${dir}/${name}.feature`, name: `/${dir}/${name}`, content: "#" });

	it.each([
		["the directory does not exist", ["/"], { existsSync: () => false }],
		["it doesn't hold features or backgrounds", ["/"], { existsSync: () => true, statSync: () => ({ isDirectory: () => true }), readdirSync: () => [] }],
		["it holds backgrounds and doesn't hold features", ["/0"], nfs({ "/0/backgrounds": { "a.feature": "#" } })],
		["the bases don't hold a file", ["/,x"], { existsSync: () => true, statSync: () => ({ isDirectory: () => true }), readdirSync: () => [] }],
		["the bases don't hold a feature", basesFrom("/0,/1"), nfs({ "/0/backgrounds": { "a.feature": "#" }, "/1/backgrounds": { "a.feature": "#" } })],
		["the first base doesn't hold a file", basesFrom("/0,/1"), nfs({ "/1/backgrounds": { "a.feature": "#" } })],
		["the second base doesn't hold a file", basesFrom("/0,/1"), nfs({ "/0/backgrounds": { "a.feature": "#" } })],
	])("refuses when %s", async (_, bases, fs) => {
		await expect(featureFiles(fs as TFileSystem).collect(bases as string[], [], undefined)).rejects.toThrow();
	});

	it.each([
		["one base with features", ["/0"], { "/0/features": { "a.feature": "#" } }, { features: [feature("/0", "features", "a")], backgrounds: [] }],
		[
			"one base with both",
			["/0"],
			{ "/0/features": { "a.feature": "#" }, "/0/backgrounds": { "b.feature": "#" } },
			{ features: [feature("/0", "features", "a")], backgrounds: [feature("/0", "backgrounds", "b")] },
		],
		[
			"two bases, each with features",
			basesFrom("/0,/1"),
			{ "/0/features": { "a.feature": "#" }, "/1/features": { "b.feature": "#" } },
			{ features: [feature("/0", "features", "a"), feature("/1", "features", "b")], backgrounds: [] },
		],
		[
			"two bases, one holding the features and the other the backgrounds",
			basesFrom("/0,/1"),
			{ "/0/backgrounds": { "a.feature": "#" }, "/1/features": { "b.feature": "#" } },
			{ features: [feature("/1", "features", "b")], backgrounds: [feature("/0", "backgrounds", "a")] },
		],
	])("collects %s", async (_, bases, files, expected) => {
		expect(await featureFiles(nfs(files)).collect(bases as string[], [], undefined)).toEqual(expected);
	});

	it("collects a base that names a file as one feature, whatever its extension, where the filter takes it", async () => {
		const dir = mkdtempSync(join(tmpdir(), "file-base-"));
		const guide = join(dir, "GUIDE.md");
		writeFileSync(guide, '# A guide\n\n    set example to "test"\n');
		const collected = await featureFiles(nodeFS).collect([guide], ["GUIDE"], undefined);
		expect(collected.features.map(({ base, path, content }) => ({ base, path, content }))).toEqual([{ base: dir, path: "/GUIDE.md", content: readFileSync(guide, "utf-8") }]);
		await expect(featureFiles(nodeFS).collect([guide], ["other"], undefined), "a filter that doesn't take the file doesn't collect a feature").rejects.toThrow(
			"doesn't hold a feature",
		);
	});
});

describe("shouldProcess", () => {
	it.each([
		["a call without a type or a filter takes everything", "hi.feature", undefined, undefined, true],
		["a filter matching the name takes it", "hi.feature", undefined, ["hi"], true],
		["a filter matching the file, not a directory above it, takes it", "/root/root.feature", undefined, ["root"], true],
		["a type the file is not is refused", "hi.feature", "wrong", undefined, false],
		["a filter the name does not match is refused", "hi.feature", undefined, ["wrong"], false],
		["a filter matching only a directory above the file is refused", "/root/hi.feature", undefined, ["root"], false],
	])("%s", (_, path, type, filter, expected) => {
		expect(shouldProcess(path as string, type as string | undefined, filter as string[] | undefined)).toBe(expected);
	});
});
