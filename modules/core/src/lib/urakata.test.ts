import { describe, expect, it, vi } from "vitest";
import { UrakataRegistry, type IUrakataTicker, type IUrakataWatcher } from "./urakata.js";
import { getDefaultWorld } from "./test/lib.js";

const noOpErrorHandler = () => undefined;

function makeRegistry(onError = noOpErrorHandler) {
	return new UrakataRegistry(getDefaultWorld(), onError);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("UrakataRegistry", () => {
	it("allocates a synthetic seqPath per registration and increments tickIndex per tick", async () => {
		const registry = makeRegistry();
		const seen: number[][] = [];
		const ticker: IUrakataTicker = {
			id: "t1",
			description: "test",
			intervalMs: 5,
			tick: ({ seqPath }) => {
				seen.push(seqPath);
			},
		};
		const u = registry.register(ticker);
		expect(u.kind).toBe("ticker");
		const rootLen = u.seqPath.length;
		await sleep(40);
		await registry.stop(u.id);
		expect(seen.length).toBeGreaterThan(0);
		const tickRoot = seen[0].slice(0, rootLen);
		for (const sp of seen) {
			expect(sp.slice(0, rootLen)).toEqual(tickRoot);
			expect(sp).toHaveLength(rootLen + 1);
		}
		const tickSuffixes = seen.map((sp) => sp[rootLen]);
		expect(tickSuffixes).toEqual([...tickSuffixes].sort((a, b) => a - b));
	});

	it("schedules ticker via setTimeout-recursion so a slow tick never overlaps itself", async () => {
		const registry = makeRegistry();
		let inFlight = 0;
		let maxInFlight = 0;
		const ticker: IUrakataTicker = {
			id: "slow",
			description: "slow",
			intervalMs: 1,
			tick: async () => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await sleep(15);
				inFlight--;
			},
		};
		const u = registry.register(ticker);
		await sleep(60);
		await registry.stop(u.id);
		expect(maxInFlight).toBe(1);
	});

	it("wraps tick errors, increments errorCount, calls the error reporter, and continues scheduling", async () => {
		const reported: Array<{ id: string; message: string }> = [];
		const registry = makeRegistry((id, _seq, err) => reported.push({ id, message: err.message }));
		let calls = 0;
		const ticker: IUrakataTicker = {
			id: "bad",
			description: "fails on every tick",
			intervalMs: 5,
			tick: () => {
				calls++;
				throw new Error("boom");
			},
		};
		const u = registry.register(ticker);
		await sleep(40);
		await registry.stop(u.id);
		expect(calls).toBeGreaterThan(1);
		expect(registry.get(u.id).errorCount).toBe(calls);
		expect(reported.every((r) => r.message === "boom")).toBe(true);
	});

	it("enforces tickTimeoutMs without halting the loop", async () => {
		const reported: string[] = [];
		const registry = makeRegistry((_id, _sp, err) => reported.push(err.message));
		let calls = 0;
		const ticker: IUrakataTicker = {
			id: "hang",
			description: "hangs",
			intervalMs: 5,
			tickTimeoutMs: 10,
			tick: async () => {
				calls++;
				await sleep(60);
			},
		};
		const u = registry.register(ticker);
		await sleep(50);
		await registry.stop(u.id);
		expect(calls).toBeGreaterThan(1);
		expect(reported.some((m) => m.includes("exceeded 10ms"))).toBe(true);
	});

	it("watcher receives abort signal on stop and the run promise resolves", async () => {
		const registry = makeRegistry();
		const watcher: IUrakataWatcher = {
			id: "w1",
			description: "watcher",
			run: async ({ signal }) => {
				await new Promise<void>((resolve) => {
					if (signal.aborted) return resolve();
					signal.addEventListener("abort", () => resolve(), { once: true });
				});
			},
		};
		const u = registry.register(watcher);
		expect(u.kind).toBe("watcher");
		await registry.stop(u.id);
		expect(registry.get(u.id).status).toBe("stopped");
	});

	it("rejects duplicate ids", () => {
		const registry = makeRegistry();
		registry.register({ id: "dup", description: "", intervalMs: 1000, tick: () => undefined });
		expect(() => registry.register({ id: "dup", description: "", intervalMs: 1000, tick: () => undefined })).toThrow(/already registered/);
	});

	it("throws on unknown id for get/stop", async () => {
		const registry = makeRegistry();
		expect(() => registry.get("nope")).toThrow(/not found/);
		await expect(registry.stop("nope")).rejects.toThrow(/not found/);
	});

	it("forget halts then removes; subsequent lookup throws", async () => {
		const registry = makeRegistry();
		const u = registry.register({ id: "f1", description: "", intervalMs: 1000, tick: () => undefined });
		await registry.forget(u.id);
		expect(() => registry.get(u.id)).toThrow(/not found/);
	});

	it("stopAll halts every registered urakata", async () => {
		const registry = makeRegistry();
		const ticks = vi.fn();
		registry.register({ id: "a", description: "", intervalMs: 5, tick: ticks });
		registry.register({ id: "b", description: "", intervalMs: 5, tick: ticks });
		await sleep(20);
		await registry.stopAll();
		const ticksAtStop = ticks.mock.calls.length;
		await sleep(20);
		expect(ticks.mock.calls.length).toBe(ticksAtStop);
	});
});
