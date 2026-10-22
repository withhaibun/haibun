import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { CAPTURE } from "@haibun/core/lib/domains/protocol.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import StorageFS from "./storage-fs-stepper.js";
import { describeStorage } from "@haibun/domain-storage/test/storage-conformance.js";

// What this storage shares with every other is the specification below; what is here is its own: where an artifact
// lands on a filesystem. The capture key is the WORLD's own tag.key (getCaptureLocation reads loc.tag.key), so assert
// against that, never a separately-imported Timer.key, which is a different value when the module loads twice under
// vitest (its own static startTime), the source of the historic flake.

const scratch = mkdtempSync(join(tmpdir(), "haibun-storage-fs-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
describeStorage("the filesystem", () => new StorageFS(), scratch);

describe("a private file on the filesystem", () => {
	it("is readable and writable by its owner alone, in a directory only its owner enters", () => {
		const file = join(scratch, "private", "a.key");
		new StorageFS().writePrivateFile(file, "kept");
		expect(statSync(file).mode & 0o777, "the file").toBe(0o600);
		expect(statSync(join(scratch, "private")).mode & 0o777, "the directory it made").toBe(0o700);
	});
});

describe("an artifact's file reached through a link on the filesystem", () => {
	it("is refused where the link leads outside the instance's artifact directory, and stays", () => {
		const storageFS = new StorageFS();
		storageFS.world = getDefaultWorld();
		const elsewhere = join(scratch, "elsewhere");
		mkdirSync(elsewhere, { recursive: true });
		writeFileSync(join(elsewhere, "linked.png"), "not an artifact");
		const base = resolve(storageFS.getArtifactBasePath());
		mkdirSync(base, { recursive: true });
		const link = join(base, "linked");
		symlinkSync(elsewhere, link);
		try {
			expect(storageFS.removeArtifactFile(storageFS.world.tag.key, "linked/linked.png")).toEqual({
				refused: `${realpathSync(join(elsewhere, "linked.png"))} is outside the instance's artifact directory ${resolve(storageFS.getArtifactRoot())}`,
			});
			expect(existsSync(join(elsewhere, "linked.png"))).toBe(true);
		} finally {
			unlinkSync(link);
		}
	});
});

describe("getArtifactBasePath", () => {
	it("returns base path without seq/featn", () => {
		const storageFS = new StorageFS();
		storageFS.world = getDefaultWorld();
		const basePath = storageFS.getArtifactBasePath();
		expect(basePath).toEqual(`./${CAPTURE}/default/${storageFS.world.tag.key}`);
		// Verify the path doesn't hold seq/featn
		expect(basePath).not.toContain("seq-");
		expect(basePath).not.toContain("featn-");
	});
});

describe("saveArtifact", () => {
	it("with subpath returns correct paths", async () => {
		const storageFS = new StorageFS();
		storageFS.world = getDefaultWorld();

		const saved = await storageFS.saveArtifact("test.png", Buffer.from("fake-image"), "image");

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

		const saved = await storageFS.saveArtifact("report.html", "<html></html>");

		// Feature-relative for serialized HTML (without a subpath)
		expect(saved.featureRelativePath).toEqual("./report.html");

		// Base-relative for live server
		expect(saved.baseRelativePath).toMatch(/^featn-0\/report\.html$/);

		// Absolute path exists
		expect(storageFS.exists(saved.absolutePath)).toBe(true);

		// Cleanup
		storageFS.rm(saved.absolutePath);
	});
});
