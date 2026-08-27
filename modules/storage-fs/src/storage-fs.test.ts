import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CAPTURE } from "@haibun/core/schema/protocol.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import StorageFS from "./storage-fs.js";
import { describeStorage } from "@haibun/domain-storage/test/storage-conformance.js";
import { EMediaTypes } from "@haibun/domain-storage/media-types.js";

// What this storage shares with every other is the specification below; what is here is its own: where an artifact
// lands on a filesystem. The capture key is the WORLD's own tag.key (getCaptureLocation reads loc.tag.key), so assert
// against that, never a separately-imported Timer.key, which is a different value when the module loads twice under
// vitest (its own static startTime), the source of the historic flake.

const scratch = mkdtempSync(join(tmpdir(), "haibun-storage-fs-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
describeStorage("the filesystem", () => new StorageFS(), scratch);

describe("getArtifactBasePath", () => {
	it("returns base path without seq/featn", () => {
		const storageFS = new StorageFS();
		storageFS.world = getDefaultWorld();
		const basePath = storageFS.getArtifactBasePath();
		expect(basePath).toEqual(`./${CAPTURE}/default/${storageFS.world.tag.key}`);
		// Verify no seq/featn in path
		expect(basePath).not.toContain("seq-");
		expect(basePath).not.toContain("featn-");
	});
});

describe("saveArtifact", () => {
	it("with subpath returns correct paths", async () => {
		const storageFS = new StorageFS();
		storageFS.world = getDefaultWorld();

		const saved = await storageFS.saveArtifact("test.png", Buffer.from("fake-image"), EMediaTypes.image, "image");

		// Feature-relative for serialized HTML
		expect(saved.featureRelativePath).toEqual("./image/test.png");

		// Base-relative for live server (includes featn)
		expect(saved.baseRelativePath).toMatch(/^featn-0\/image\/test\.png$/);

		// Absolute path exists
		expect(storageFS.exists(saved.absolutePath)).toBe(true);

		// Cleanup
		storageFS.rm(saved.absolutePath);
	});

	it("without subpath returns correct paths", async () => {
		const storageFS = new StorageFS();
		storageFS.world = getDefaultWorld();

		const saved = await storageFS.saveArtifact("report.html", "<html></html>", EMediaTypes.html);

		// Feature-relative for serialized HTML (no subpath)
		expect(saved.featureRelativePath).toEqual("./report.html");

		// Base-relative for live server
		expect(saved.baseRelativePath).toMatch(/^featn-0\/report\.html$/);

		// Absolute path exists
		expect(storageFS.exists(saved.absolutePath)).toBe(true);

		// Cleanup
		storageFS.rm(saved.absolutePath);
	});
});
