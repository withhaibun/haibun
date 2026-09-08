import { vitest, describe, it, expect, vi } from "vitest";
import { afterEach } from "node:test";

vitest.useFakeTimers();
import { OK, TStepArgs } from "@haibun/core/schema/protocol.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import StorageMem from "./storage-mem.js";
import { describeStorage } from "@haibun/domain-storage/test/storage-conformance.js";
import { TAnyFixme } from "@haibun/core/lib/fixme.js";

// The capture key is the WORLD's own tag.key (getCaptureLocation reads loc.tag.key); assert against that, never a
// separately-imported Timer.key — a different value when the module loads twice under vitest (its own static startTime).

vi.spyOn(process, "cwd").mockReturnValue("/");

// What this storage shares with every other is the specification below; what is here is its own: the base files a test
// hands it, and the steppers that read through it.
describeStorage("memory", () => new StorageMem(), "/");

describe("BASE_FS", () => {
	afterEach(() => {
		(StorageMem.BASE_FS as TAnyFixme) = undefined;
	});
	it("finds BASE_FS file", () => {
		StorageMem.BASE_FS = { hello: "world" };
		const storageMem = new StorageMem();
		expect(storageMem.readFile("hello", "utf-8")).toEqual("world");
	});
	it("finds BASE_FS subdir", () => {
		StorageMem.BASE_FS = { "/hello/world": "eh" };
		const storageMem = new StorageMem();
		expect(storageMem.readFile("/hello/world", "utf-8")).toEqual("eh");
	});
});

describe("AStorage steppers", () => {
	it("readFile returns contents as products", async () => {
		const storageMem = new StorageMem();
		const world = getDefaultWorld();
		storageMem.setWorld(world, []);
		storageMem.volume.writeFileSync("/test.txt", "hello world");
		const res = await storageMem.steps.readFile?.action({ where: "/test.txt" } as TStepArgs);
		expect(res.ok).toBe(true);
		expect(res.products?.contents).toEqual("hello world");
	});

	it("fileIsRecent verifies file age", async () => {
		const storageMem = new StorageMem();
		const world = getDefaultWorld();
		storageMem.setWorld(world, []);

		storageMem.volume.writeFileSync("/recent.txt", "new");

		// Should pass for 1 minute
		let res = await storageMem.steps.fileIsRecent?.action({ where: "/recent.txt", minutes: "1" } as TStepArgs);
		expect(res).toEqual(OK);

		// Advance time by 5 minutes
		const now = Date.now();
		vi.setSystemTime(now + 5 * 60 * 1000);

		// Should fail for 2 minutes
		res = await storageMem.steps.fileIsRecent?.action({ where: "/recent.txt", minutes: "2" } as TStepArgs);
		expect(res.ok).toBe(false);

		// Should pass for 10 minutes
		res = await storageMem.steps.fileIsRecent?.action({ where: "/recent.txt", minutes: "10" } as TStepArgs);
		expect(res).toEqual(OK);
	});

	it("testContains and testNotContains verify file content", async () => {
		const storageMem = new StorageMem();
		const world = getDefaultWorld();
		storageMem.setWorld(world, []);

		storageMem.volume.writeFileSync("/test.txt", "hello world");

		let res = await storageMem.steps.testContains?.action({ where: "/test.txt", what: "hello" } as TStepArgs);
		expect(res).toEqual(OK);

		res = await storageMem.steps.testContains?.action({ where: "/test.txt", what: "missing" } as TStepArgs);
		expect(res.ok).toBe(false);

		res = await storageMem.steps.testNotContains?.action({ where: "/test.txt", what: "missing" } as TStepArgs);
		expect(res).toEqual(OK);

		res = await storageMem.steps.testNotContains?.action({ where: "/test.txt", what: "hello" } as TStepArgs);
		expect(res.ok).toBe(false);
	});
});
