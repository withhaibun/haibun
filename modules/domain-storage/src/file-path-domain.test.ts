import { describe, expect, it } from "vitest";
import { AStorage } from "./domains/storage.js";
import type { TStorageFiles } from "./ports.js";
import { STORAGE_FILES } from "@haibun/core/lib/domains/storage-port.js";
import { getCoreDomains } from "@haibun/core/lib/pipelines/core-domains.js";
import type { TRegisteredDomain, TSourceProperty } from "@haibun/core/lib/domains/resources.js";
import type { TWorld } from "@haibun/core/lib/actuality/domains/world.js";

/** The files port over one in-memory file. */
function filesWith(content: string, at = "a.md"): TStorageFiles {
	const file = { name: at, isDirectory: false, isFile: true, created: 0, size: new TextEncoder().encode(content).length };
	return {
		readFile: (path) => (path === at ? content : "") as unknown as ReturnType<TStorageFiles["readFile"]>,
		lstatToIFile: async () => file,
		exists: (path) => path === at,
		rm: () => undefined,
		readdir: async () => [],
		writeFileBuffer: () => undefined,
		writePrivateFile: () => undefined,
		mkdir: () => undefined,
		mkdirp: () => undefined,
		realpath: (p) => p,
	};
}

/** A world whose runtime holds the storage's files, as the storage publishes them at each feature's start. */
async function worldWithStorage(content: string): Promise<TWorld> {
	const world = { runtime: {}, domains: {} } as unknown as TWorld;
	const stepper = new (class extends AStorage {})(filesWith(content));
	await stepper.setWorld(world, []);
	await stepper.cycles.startFeature?.({ resolvedFeature: undefined as never, index: 0 });
	return world;
}

function filePathProperties(world: TWorld): Record<string, TSourceProperty> {
	const domain = getCoreDomains(world)["file-path"] as TRegisteredDomain;
	return domain.properties as Record<string, TSourceProperty>;
}

function property(properties: Record<string, TSourceProperty>, name: string): TSourceProperty {
	const found = properties[name];
	if (found === undefined) throw new Error(`missing property ${name}`);
	return found;
}

describe("the FilePath domain's readable properties", () => {
	it("reads a file's text, its size, its presence, and its type through the loaded storage", async () => {
		const world = await worldWithStorage("hello α");
		const properties = filePathProperties(world);
		await expect(property(properties, "text").read("a.md", world)).resolves.toBe("hello α");
		await expect(property(properties, "size").read("a.md", world)).resolves.toBe(8);
		await expect(property(properties, "exists").read("a.md", world)).resolves.toBe(true);
		await expect(property(properties, "mediaType").read("a.md", world)).resolves.toBe("text/markdown");
	});

	it("checks is, contains and exists at the file, counting its bytes without carrying them", async () => {
		const world = await worldWithStorage("hello α");
		const evaluate = property(filePathProperties(world), "text").evaluate as NonNullable<TSourceProperty["evaluate"]>;
		expect(await evaluate("a.md", "is", "hello α", world)).toEqual({ matches: true, byteLength: 8 });
		expect(await evaluate("a.md", "contains", "llo", world)).toMatchObject({ matches: true });
		expect(await evaluate("a.md", "exists", undefined, world)).toMatchObject({ matches: true });
	});

	it("compiles a pattern through the matches evaluator, counting the bytes without carrying them", async () => {
		const world = await worldWithStorage("hello");
		const evaluate = property(filePathProperties(world), "text").evaluate as NonNullable<TSourceProperty["evaluate"]>;
		expect(await evaluate("a.md", "matches", "h*", world)).toMatchObject({ matches: true, byteLength: 5 });
	});

	it("refuses a property read before any storage loaded, naming what to run", () => {
		const bare = { runtime: {}, domains: {} } as unknown as TWorld;
		expect(() => property(filePathProperties(bare), "text").read("a.md", bare)).toThrow(/doesn't hold a storage/);
	});

	it("publishes its files on the runtime as each feature starts", async () => {
		const world = { runtime: {}, domains: {} } as unknown as TWorld;
		const files = filesWith("x");
		const stepper = new (class extends AStorage {})(files);
		await stepper.setWorld(world, []);
		await stepper.cycles.startFeature?.({ resolvedFeature: undefined as never, index: 0 });
		expect(world.runtime[STORAGE_FILES]).toBe(files);
	});
});
