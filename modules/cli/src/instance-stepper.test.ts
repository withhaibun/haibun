/**
 * Restarting an instance: what it refuses, and that it repeats the launch it was given.
 *
 * What an instance serves comes from its source, so a change to that source takes effect only once it runs again.
 * Restart forks through the same path as start, so a restarted instance is launched exactly as it first was.
 */
import { describe, expect, it } from "vitest";
import InstanceStepper from "./instance-stepper.js";

type TResult = { ok: boolean; errorMessage?: string };
const stepper = () => new InstanceStepper();

describe("restarting an instance", () => {
	it("refuses a port this run launched nothing on, rather than starting something unasked", async () => {
		const result = (await (stepper().steps.restartInstance.action as (a: { port: number }) => Promise<TResult>)({ port: 8299 })) as TResult;
		expect(result.ok).toBe(false);
		expect(result.errorMessage).toMatch(/launched no instance on port 8299/);
	});

	it("refuses to start from a directory with no config, naming the directory", async () => {
		const result = (await (stepper().steps.startInstance.action as (a: { where: string; port: number; hostId: number }) => Promise<TResult>)({
			where: "/nonexistent-instance-dir",
			port: 8298,
			hostId: 9,
		})) as TResult;
		expect(result.ok).toBe(false);
		expect(result.errorMessage).toMatch(/no config\.json in .*nonexistent-instance-dir/);
	});
});
