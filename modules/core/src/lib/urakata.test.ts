import { describe, expect, it, vi } from "vitest";
import { UrakataRegistry, URAKATA_LABEL, type IUrakataTicker } from "./urakata.js";
import { getDefaultWorld } from "./test/lib.js";

const noOpErrorHandler = () => undefined;

function makeRegistry(onError = noOpErrorHandler) {
	return new UrakataRegistry(getDefaultWorld(), onError);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait for what a case is about rather than for a length of time: a loaded machine ticks later, not never, so a case
 *  that waited a fixed span asserted how fast the machine was. `vi.waitFor` retries until the assertion holds and
 *  reports the assertion itself when it never does. */
const until = (holds: () => unknown): Promise<unknown> => vi.waitFor(holds, { timeout: 5000, interval: 1 });

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
		expect(u.stoppedAt).toBeUndefined();
		const rootLen = u.seqPath.length;
		await until(() => expect(seen.length > 1).toBe(true));
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
		let started = 0;
		const ticker: IUrakataTicker = {
			id: "slow",
			description: "slow",
			intervalMs: 1,
			tick: async () => {
				started++;
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await sleep(15);
				inFlight--;
			},
		};
		const u = registry.register(ticker);
		await until(() => expect(started > 1).toBe(true));
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
		await until(() => expect(calls > 1).toBe(true));
		await registry.stop(u.id);
		expect(calls).toBeGreaterThan(1);
		expect(registry.get(u.id).errorCount).toBe(calls);
		expect(reported.every((r) => r.message === "boom")).toBe(true);
	});

	it("on tickTimeoutMs: aborts the tick, counts exactly one error, and never overlaps the next tick with the aborted one", async () => {
		const reported: string[] = [];
		const registry = makeRegistry((_id, _sp, err) => reported.push(err.message));
		let calls = 0;
		let inFlight = 0;
		let maxInFlight = 0;
		let sawAbort = false;
		const ticker: IUrakataTicker = {
			id: "hang",
			description: "hangs past its timeout, then honours the abort",
			intervalMs: 5,
			tickTimeoutMs: 10,
			tick: async ({ signal }) => {
				calls++;
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await new Promise<void>((resolve) => {
					const t = setTimeout(resolve, 200);
					signal.addEventListener(
						"abort",
						() => {
							sawAbort = true;
							clearTimeout(t);
							resolve();
						},
						{ once: true },
					);
				});
				inFlight--;
			},
		};
		const u = registry.register(ticker);
		await until(() => expect(calls > 1 && sawAbort).toBe(true));
		await registry.stop(u.id);
		expect(calls).toBeGreaterThan(1);
		expect(sawAbort).toBe(true);
		expect(maxInFlight).toBe(1);
		// One error per timed-out tick: the abort's own settlement is not a second count.
		expect(registry.get(u.id).errorCount).toBe(reported.length);
		expect(reported.every((m) => m.includes("exceeded 10ms"))).toBe(true);
	});

	it("stop aborts an in-flight tick, awaits its settlement, sets stoppedAt, and counts no error", async () => {
		const reported: string[] = [];
		const registry = makeRegistry((_id, _sp, err) => reported.push(err.message));
		let settledAfterAbort = false;
		const ticker: IUrakataTicker = {
			id: "long",
			description: "blocks until its signal fires",
			intervalMs: 1,
			tick: ({ signal }) =>
				new Promise<void>((resolve) => {
					if (signal.aborted) return resolve();
					signal.addEventListener(
						"abort",
						() => {
							settledAfterAbort = true;
							resolve();
						},
						{ once: true },
					);
				}),
		};
		const u = registry.register(ticker);
		await sleep(10);
		await registry.stop(u.id);
		expect(settledAfterAbort).toBe(true);
		expect(registry.get(u.id).stoppedAt).toBeDefined();
		expect(registry.get(u.id).errorCount).toBe(0);
		expect(reported).toHaveLength(0);
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
		await until(() => expect(ticks.mock.calls.length > 1).toBe(true));
		await registry.stopAll();
		const ticksAtStop = ticks.mock.calls.length;
		// A quiet span after the stop, which is the one thing a clock states: nothing more happened.
		await sleep(20);
		expect(ticks.mock.calls.length).toBe(ticksAtStop);
	});
});

describe("UrakataRegistry persistence of transitions", () => {
	const readTask = async (world: ReturnType<typeof getDefaultWorld>, id: string) => world.shared.getStore().getIndividual<Record<string, unknown>>(URAKATA_LABEL, id);

	it("persists the individual on registration, on an error, and on stop: one row per id, reflecting the latest transition", async () => {
		const world = getDefaultWorld();
		const registry = new UrakataRegistry(world, () => undefined);
		let fail = true;
		const u = registry.register({
			id: "p1",
			description: "persisting task",
			intervalMs: 5,
			tick: () => {
				if (fail) throw new Error("boom");
			},
		});
		await sleep(0); // let the registration upsert flush
		const atStart = await readTask(world, u.id);
		expect(atStart?.execution).toBe(world.tag.key);
		expect(atStart?.stoppedAt).toBeUndefined();
		expect(atStart?.errorCount).toBe(0);

		await until(async () => expect(Number((await readTask(world, u.id))?.errorCount)).toBeGreaterThan(0));
		fail = false;
		const afterError = await readTask(world, u.id);
		expect(Number(afterError?.errorCount)).toBeGreaterThan(0);

		await registry.stop(u.id);
		await sleep(0);
		const afterStop = await readTask(world, u.id);
		expect(afterStop?.stoppedAt).toBeDefined();
	});

	it("leaves a prior instance's row untouched (it already tells the truth); re-registering the id overwrites it with the current instance", async () => {
		const world = getDefaultWorld();
		// A row from another run instance, never cleanly stopped: the abrupt-stop reading.
		await world.shared.getStore().upsertIndividual(URAKATA_LABEL, {
			id: "imap.idle.acct/INBOX",
			description: "from a prior instance",
			execution: "OTHER-INSTANCE",
			seqPath: [0],
			startedAt: new Date().toISOString(),
			tickIndex: 5,
			errorCount: 0,
			generatedAtTime: new Date(),
		});
		const registry = new UrakataRegistry(world, () => undefined);
		const fresh = registry.register({ id: "different.task", description: "new", intervalMs: 1000, tick: () => undefined });
		await sleep(0);
		const prior = await readTask(world, "imap.idle.acct/INBOX");
		expect(prior?.execution).toBe("OTHER-INSTANCE"); // untouched
		expect(prior?.stoppedAt).toBeUndefined();
		const freshRow = await readTask(world, fresh.id);
		expect(freshRow?.execution).toBe(world.tag.key);
		await registry.stopAll();

		// Re-registering the prior id (a restart) overwrites it with the current instance and no stoppedAt.
		const registry2 = new UrakataRegistry(world, () => undefined);
		registry2.register({ id: "imap.idle.acct/INBOX", description: "restarted", intervalMs: 1000, tick: () => undefined });
		await sleep(0);
		const restarted = await readTask(world, "imap.idle.acct/INBOX");
		expect(restarted?.execution).toBe(world.tag.key);
		expect(restarted?.stoppedAt).toBeUndefined();
		await registry2.stopAll();
	});
});
