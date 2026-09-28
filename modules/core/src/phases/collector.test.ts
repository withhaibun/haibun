import { describe, it, expect } from "vitest";

import { basesFrom } from "../lib/util/index.js";
import { TFileSystem } from "../lib/util/node/workspace-lib.js";
import { getFeaturesAndBackgrounds, shouldProcess } from "./collector.js";

class MockFS {
	constructor(private files: object) {}

	existsSync(where: string) {
		return !!this.files[where];
	}
	readFileSync(where: string) {
		const e = where.split("/");
		const h = e.slice(0, 3).join("/");
		return this.files[h][e[3]];
	}
	statSync(where: string) {
		return { isDirectory: () => !!this.files[where] };
	}
	readdirSync(where: string): string[] {
		return Object.keys(this.files[where] || {});
	}
}

const nfs = (files: object) => <TFileSystem>(new MockFS(files) as unknown);

describe("getFeaturesAndBackgrounds", () => {
	// A base must offer features. Every refusal below is the same claim: given bases that don't hold a feature are an error,
	// whether the directory is missing, empty, or holds backgrounds alone.
	const feature = (base: string, dir: "features" | "backgrounds", name: string) => ({
		base,
		path: `/${dir}/${name}.feature`,
		name: `${base}/${dir}/${name}`,
		type: "feature",
		content: "#",
	});

	it.each([
		["the directory does not exist", ["/"], { existsSync: () => false }],
		["it doesn't hold features or backgrounds", ["/"], { existsSync: () => true, readdirSync: () => [] }],
		["it holds backgrounds and doesn't hold features", ["/0"], nfs({ "/0/backgrounds": { "a.feature": "#" } })],
		["the bases don't hold a file", ["/,x"], { existsSync: () => true, readdirSync: () => [] }],
		["the bases don't hold a feature", basesFrom("/0,/1"), nfs({ "/0/backgrounds": { "a.feature": "#" }, "/1/backgrounds": { "a.feature": "#" } })],
		["the first base doesn't hold a file", basesFrom("/0,/1"), nfs({ "/1/backgrounds": { "a.feature": "#" } })],
		["the second base doesn't hold a file", basesFrom("/0,/1"), nfs({ "/0/backgrounds": { "a.feature": "#" } })],
	])("refuses when %s", async (_, bases, fs) => {
		await expect(getFeaturesAndBackgrounds(bases as string[], [], undefined, fs as TFileSystem)).rejects.toThrow();
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
		expect(await getFeaturesAndBackgrounds(bases as string[], [], undefined, nfs(files as object))).toEqual(expected);
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
