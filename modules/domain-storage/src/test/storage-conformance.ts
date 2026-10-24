/**
 * This specification runs against every storage. A stepper writes an artifact, reads a file and lists a directory through
 * `AStorage`. The stepper doesn't depend on which storage implements `AStorage`. Actuality uses StorageFS, and many tests
 * use StorageMem. A behaviour that differs between them lets a test pass in memory while the same code fails on the
 * filesystem. The tests of both storages run these cases, so a difference in a checked behaviour fails at least one of
 * the two tests.
 *
 * `@haibun/domain-storage` declares `AStorage` and exports this specification. A test of any implementation calls
 * `describeStorage` with its own factory and a writable directory.
 */
import { describe, it, expect } from "vitest";
import { CAPTURE, DEFAULT_DEST, OK } from "@haibun/core/lib/domains/protocol.js";
import { getDefaultWorld, getTestWorldWithOptions } from "@haibun/core/lib/test/lib.js";
import { relative, resolve } from "path";
import type { AStorage } from "../domains/storage.js";

/**
 * Runs the specification against one storage. Each case calls `make` once and uses the storage it returns. The directory
 * and file cases create their paths under `root`. The test of StorageFS passes a temporary directory as `root`, and the
 * test of StorageMem passes `/`. The `ensureCaptureLocation` case creates the capture location under the working
 * directory.
 */
export function describeStorage(name: string, make: () => AStorage, root: string): void {
	const at = (path: string): string => `${root.replace(/\/$/, "")}/${path}`;

	describe(`the storage (${name})`, () => {
		it("returns the capture location for a world's tag and returns the same location on a second call", async () => {
			const storage = make();
			const world = getDefaultWorld();
			const asked = world;
			expect(await storage.getCaptureLocation(asked, "test")).toEqual(`./${CAPTURE}/default/${world.tag.key}/featn-0/test`);
			expect(await storage.getCaptureLocation(asked, "test")).toEqual(await storage.getCaptureLocation(asked, "test"));
		});

		it("returns the capture location under the destination in a world's options", async () => {
			const world = getTestWorldWithOptions();
			expect(await make().getCaptureLocation(world, "test")).toEqual(`./${CAPTURE}/${DEFAULT_DEST}/${world.tag.key}/featn-0/test`);
		});

		it("creates the capture location through ensureCaptureLocation and returns that location", async () => {
			const storage = make();
			const world = getDefaultWorld();
			const location = await storage.getCaptureLocation(world, "test");
			const ensured = await storage.ensureCaptureLocation(world, "test");
			expect(ensured, "ensureCaptureLocation returns the location getCaptureLocation returns").toEqual(location);
			expect(storage.exists(location)).toBe(true);
		});

		it("creates a directory and a nested directory with its parents and reports that each exists", () => {
			const storage = make();
			expect(storage.exists(at("made")), "the directory doesn't exist before mkdir creates it").toBe(false);
			storage.mkdir(at("made"));
			expect(storage.exists(at("made"))).toBe(true);
			storage.mkdirp(at("made/under/here"));
			expect(storage.exists(at("made/under/here"))).toBe(true);
		});

		it("writes a file and reads its contents", () => {
			const storage = make();
			storage.mkdirp(at("written"));
			storage.writeFileBuffer(at("written/one.txt"), Buffer.from("what was written"));
			expect(storage.readFile(at("written/one.txt"), "utf-8")).toEqual("what was written");
		});

		it("writes a private file in a new directory and refuses to replace an existing file", () => {
			const storage = make();
			storage.writePrivateFile(at("kept/under/here/a.key"), "what is kept");
			expect(storage.readFile(at("kept/under/here/a.key"), "utf-8")).toEqual("what is kept");
			expect(() => storage.writePrivateFile(at("kept/under/here/a.key"), "another"), "writePrivateFile doesn't replace an existing file").toThrow();
			expect(storage.readFile(at("kept/under/here/a.key"), "utf-8")).toEqual("what is kept");
		});

		it("states how many files a directory holds and the whole text of a file, and refuses a count or a text that differs", async () => {
			const storage = make();
			storage.mkdirp(at("counted"));
			storage.writeFileBuffer(at("counted/one.txt"), Buffer.from("the whole text"));
			expect(await storage.steps.filesCount.action({ where: at("counted"), count: 1 })).toEqual(OK);
			expect(await storage.steps.filesCount.action({ where: at("counted"), count: 2 })).toMatchObject({ ok: false, errorMessage: `directory ${at("counted")} has 1 files` });
			expect(storage.steps.testIs.action({ where: at("counted/one.txt"), what: "the whole text" })).toEqual(OK);
			expect(storage.steps.testIs.action({ where: at("counted/one.txt"), what: "the whole" })).toMatchObject({ ok: false });
		});

		it("lists what a directory holds", async () => {
			const storage = make();
			storage.mkdirp(at("listed/within"));
			expect(await storage.readdir(at("listed"))).toEqual(["within"]);
		});

		it("reports whether a path is a directory or a file through lstatToIFile and readdirStat", async () => {
			const storage = make();
			storage.mkdirp(at("walked/within"));
			storage.writeFileBuffer(at("walked/one.txt"), Buffer.from("a file"));
			const directory = await storage.lstatToIFile(at("walked/within"));
			expect(directory.isDirectory).toBe(true);
			const listed = await storage.readdirStat(at("walked"));
			expect(listed.find((f) => f.name.endsWith("within"))?.isDirectory, "readdirStat reports the directory").toBe(true);
			expect(listed.find((f) => f.name.endsWith("one.txt"))?.isFile, "readdirStat reports the file").toBe(true);
		});

		it("removes the file an artifact's record names in the instance's artifact directory, and finds a file already gone", async () => {
			const storage = withWorld(make());
			const saved = await storage.saveArtifact("removed.png", Buffer.from("an artifact"), "image");
			const key = storage.getWorld().tag.key;
			expect(storage.removeArtifactFile(key, saved.baseRelativePath)).toEqual({ removed: resolve(saved.absolutePath) });
			expect(storage.exists(saved.absolutePath)).toBe(false);
			expect(storage.removeArtifactFile(key, saved.baseRelativePath), "a file already gone isn't an error").toEqual({ gone: resolve(saved.absolutePath) });
		});

		it("refuses a file an artifact's record names outside the instance's artifact directory, and leaves it", () => {
			const storage = withWorld(make());
			storage.writeFileBuffer(at("outside.png"), Buffer.from("not an artifact"));
			const outsideFile = resolve(at("outside.png"));
			const escaping = relative(resolve(storage.getArtifactBasePath()), outsideFile);
			const refusal = { refused: `${outsideFile} is outside the instance's artifact directory ${resolve(storage.getArtifactRoot())}` };
			expect(storage.removeArtifactFile(storage.getWorld().tag.key, escaping), "a path that climbs out of the directory").toEqual(refusal);
			expect(storage.removeArtifactFile(storage.getWorld().tag.key, outsideFile), "an absolute path").toEqual(refusal);
			expect(storage.exists(outsideFile)).toBe(true);
		});
	});
}

/** Returns `storage` with a world, whose options and tag locate the artifact directory. */
function withWorld(storage: AStorage): AStorage {
	storage.world = getDefaultWorld();
	return storage;
}
