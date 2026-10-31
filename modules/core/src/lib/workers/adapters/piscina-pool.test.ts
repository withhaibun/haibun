/**
 * The worker pool runs a task in a worker, performs the effects it requests by message, parses what each side passes, and releases
 * its workers once they are idle.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { TWorkerTask } from "../domains/worker-task.js";
import { piscinaPool, workerArguments } from "./piscina-pool.js";

const IDLE_MS = 100;
const ECHO: TWorkerTask<{ text: string }, { doubled: string }> = {
	name: "the echo task",
	module: new URL("../../test/echo-task.ts", import.meta.url),
	input: z.object({ text: z.string() }),
	output: z.object({ doubled: z.string() }),
};

describe("the worker pool", () => {
	it("runs a task with each effect it requests performed by its process, and releases its idle worker", { timeout: 30_000 }, async () => {
		const pool = piscinaPool(IDLE_MS);
		try {
			const requested: unknown[] = [];
			const output = await pool.run(ECHO, { text: "ab" }, (request) => {
				requested.push(request);
				return Promise.resolve(String(request).toUpperCase());
			});
			expect(output).toEqual({ doubled: "ABAB" });
			expect(requested).toEqual(["ab", "ab"]);
			await new Promise((idled) => setTimeout(idled, IDLE_MS * 10));
			expect(pool.threads()).toBe(0);
		} finally {
			await pool.close();
		}
	});

	it("refuses an effect where its caller doesn't perform effects", { timeout: 30_000 }, async () => {
		const pool = piscinaPool(IDLE_MS);
		try {
			await expect(pool.run(ECHO, { text: "ab" })).rejects.toThrow("the task the echo task requested an effect, and its caller doesn't perform effects");
		} finally {
			await pool.close();
		}
	});

	it("starts a worker with the process's warning, source map and experimental options, and without V8's, its conditions or its loaders", () => {
		const argv = [
			"--expose-gc",
			"--conditions",
			"haibun-source",
			"--conditions=haibun-source",
			"--import",
			"tsx",
			"--no-warnings",
			"--disable-warning=ExperimentalWarning",
			"--enable-source-maps",
			"--experimental-vm-modules",
		];
		expect(workerArguments(argv)).toEqual(["--no-warnings", "--disable-warning=ExperimentalWarning", "--enable-source-maps", "--experimental-vm-modules"]);
	});
});
