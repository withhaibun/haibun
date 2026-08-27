/**
 * One specification, every storage. A stepper writes an artifact, reads a file and walks a directory through `AStorage`
 * and does not know which storage is under it: the filesystem in a run, memory in a test. A difference between them is
 * a test that passes where the code will not run, which is the failure this exists to prevent, so both answer these
 * cases rather than each carrying a suite of its own.
 *
 * Exported from the module that declares `AStorage`, so an implementation anywhere is held to the same rule by bringing
 * its own factory and a directory it may write in.
 */
import { describe, it, expect } from "vitest";
import { CAPTURE, DEFAULT_DEST } from "@haibun/core/schema/protocol.js";
import { getDefaultWorld, getTestWorldWithOptions } from "@haibun/core/lib/test/lib.js";
import { EMediaTypes } from "../media-types.js";
import type { AStorage } from "../AStorage.js";

/**
 * Run the specification against one storage. `make` returns a storage ready to use, and `root` is a directory it may
 * write in, since a storage over a real filesystem must not be handed the machine's root.
 */
export function describeStorage(name: string, make: () => AStorage, root: string): void {
	const at = (path: string): string => `${root.replace(/\/$/, "")}/${path}`;

	describe(`the storage (${name})`, () => {
		it("names the capture location a world asks for, and the same one whatever it is asked twice", async () => {
			const storage = make();
			const world = getDefaultWorld();
			const asked = { ...world, mediaType: EMediaTypes.json };
			expect(await storage.getCaptureLocation(asked, "test")).toEqual(`./${CAPTURE}/default/${world.tag.key}/featn-0/test`);
			expect(await storage.getCaptureLocation(asked, "test")).toEqual(await storage.getCaptureLocation(asked, "test"));
		});

		it("names the capture location under the destination a world's options state", async () => {
			const world = getTestWorldWithOptions();
			expect(await make().getCaptureLocation({ ...world, mediaType: EMediaTypes.json }, "test")).toEqual(`./${CAPTURE}/${DEFAULT_DEST}/${world.tag.key}/featn-0/test`);
		});

		it("makes the capture location exist when asked to ensure it", async () => {
			const storage = make();
			const world = { ...getDefaultWorld(), mediaType: EMediaTypes.json };
			const location = await storage.getCaptureLocation(world, "test");
			const ensured = await storage.ensureCaptureLocation(world, "test");
			expect(ensured, "the location it made is the one it named").toEqual(location);
			expect(storage.exists(location)).toBe(true);
		});

		it("creates a directory, with its parents where they are named, and says which exist", () => {
			const storage = make();
			expect(storage.exists(at("made")), "nothing exists before it is made").toBe(false);
			storage.mkdir(at("made"));
			expect(storage.exists(at("made"))).toBe(true);
			storage.mkdirp(at("made/under/here"));
			expect(storage.exists(at("made/under/here"))).toBe(true);
		});

		it("writes a file and reads back what was written", () => {
			const storage = make();
			storage.mkdirp(at("written"));
			storage.writeFileBuffer(at("written/one.txt"), Buffer.from("what was written"), EMediaTypes.json);
			expect(storage.readFile(at("written/one.txt"), "utf-8")).toEqual("what was written");
		});

		it("lists what a directory holds", async () => {
			const storage = make();
			storage.mkdirp(at("listed/within"));
			expect(await storage.readdir(at("listed"))).toEqual(["within"]);
		});

		it("says of a path whether it is a directory or a file, listing or on its own", async () => {
			const storage = make();
			storage.mkdirp(at("walked/within"));
			storage.writeFileBuffer(at("walked/one.txt"), Buffer.from("a file"), EMediaTypes.json);
			const directory = await storage.lstatToIFile(at("walked/within"));
			expect(directory.isDirectory).toBe(true);
			const listed = await storage.readdirStat(at("walked"));
			expect(listed.find((f) => f.name.endsWith("within"))?.isDirectory, "a directory it listed").toBe(true);
			expect(listed.find((f) => f.name.endsWith("one.txt"))?.isFile, "and a file it listed").toBe(true);
		});
	});
}
