import { describe, expect, it, vi } from "vitest";
import { UrakataRegistry, URAKATA_LABEL, type IUrakataTicker } from "./urakata.js";
import { getDefaultWorld } from "./test/lib.js";
import { accessBound, actingAs, runActingAs, runAuthorizedWith } from "./capability-context.js";
import { AUTHORITY_KEY, SessionAuthority } from "./session-authority.js";
import { actionsToReadAndWrite, EVERY_ACTION, readAction, writeAction, writtenAt } from "./actions.js";
import { Access } from "./resources.js";
import { itemAt } from "./util/item-at.js";
import { recordOf } from "./records/pipelines/record-reads.js";
import { mapDefinitionsToDomains } from "./domains.js";
import { urakataTaskDomainDefinition } from "../steps/urakata-stepper.js";

const noOpErrorHandler = () => undefined;
const STARTER = "did:example:starter";

function makeRegistry(onError: ConstructorParameters<typeof UrakataRegistry>[1] = noOpErrorHandler) {
	return new UrakataRegistry(getDefaultWorld(), onError);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Waits for the asserted state rather than for a length of time. A ticker on a loaded machine ticks later but still
 *  ticks, so a fixed wait would test the machine's speed. `vi.waitFor` retries until the assertion holds and reports
 *  the failing assertion at the timeout. */
const until = (holds: () => unknown): Promise<unknown> => vi.waitFor(holds, { timeout: 5000, interval: 1 });

describe("UrakataRegistry", () => {
	it("allocates a synthetic seqPath per registration and increments tickIndex per tick", async () => {
		const registry = makeRegistry();
		const seen: number[][] = [];
		const ticker: IUrakataTicker = {
			needs: [],
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
		const tickRoot = itemAt(seen, 0).slice(0, rootLen);
		for (const sp of seen) {
			expect(sp.slice(0, rootLen)).toEqual(tickRoot);
			expect(sp).toHaveLength(rootLen + 1);
		}
		const tickSuffixes = seen.map((sp) => itemAt(sp, rootLen));
		expect(tickSuffixes).toEqual([...tickSuffixes].sort((a, b) => a - b));
	});

	it("runs each tick with its ticker's needs, at the read ceiling those actions grant and as its starter", async () => {
		const registry = makeRegistry();
		const bounds: ReturnType<typeof accessBound>[] = [];
		const actors: (string | undefined)[] = [];
		const needs = actionsToReadAndWrite(Access.private, [Access.private, Access.public]);
		const ticker: IUrakataTicker = { id: "bound", description: "test", intervalMs: 5, needs, tick: () => void (bounds.push(accessBound()), actors.push(actingAs())) };
		// Registers the ticker inside a step that holds every action. A feature line of actuality holds the same authority.
		const u = await runAuthorizedWith([EVERY_ACTION], () => runActingAs(STARTER, () => Promise.resolve(registry.register(ticker))));
		await until(() => expect(bounds.length).toBeGreaterThan(0));
		await registry.stop(u.id);
		expect(bounds[0], "the tick holds its ticker's needs and doesn't hold every action the starting step held").toEqual({ ceiling: Access.private, held: needs });
		expect(actors[0]).toBe(STARTER);
		expect(writtenAt(Access.public, Access.private, itemAt(bounds, 0)), "a tick writes a record that states public at public").toBe(Access.public);
		expect(u).toMatchObject({ startedBy: STARTER, holds: needs });
	});

	it("refuses a start by a caller that doesn't hold the ticker's needs, and names the actions to delegate", () => {
		const registry = makeRegistry();
		const ticker: IUrakataTicker = {
			id: "short",
			description: "the watch of Trash",
			intervalMs: 5,
			needs: [readAction(Access.private), writeAction(Access.public)],
			tick: () => undefined,
		};
		expect(() => runAuthorizedWith([readAction(Access.private)], () => Promise.resolve(registry.register(ticker)))).toThrow(
			"Can't start the watch of Trash: it needs Write:public, which the caller doesn't hold. Delegate Write:public to the key that starts it.",
		);
	});

	it("stops a ticker once the authority its starter proved is revoked, and records the reason in stopReason", async () => {
		const world = getDefaultWorld();
		const authority = new SessionAuthority();
		world.runtime.keys = { ...world.runtime.keys, [AUTHORITY_KEY]: authority };
		const registry = new UrakataRegistry(world, noOpErrorHandler);
		const ticker: IUrakataTicker = { id: "resting", description: "test", intervalMs: 5, needs: [readAction(Access.private)], tick: () => undefined };
		const restsOn = { capabilities: ["urn:cap:starter"] };
		const u = await runAuthorizedWith([readAction(Access.private)], () => runActingAs(STARTER, () => Promise.resolve(registry.register(ticker)), restsOn));
		authority.revoked("urn:cap:starter");
		await until(() => expect(registry.get(u.id).stoppedAt).toBeDefined());
		expect(registry.get(u.id).stopReason).toBe("urn:cap:starter was revoked");
	});

	it("schedules a ticker by setTimeout recursion so a slow tick never overlaps the next one", async () => {
		const registry = makeRegistry();
		let inFlight = 0;
		let maxInFlight = 0;
		let started = 0;
		const ticker: IUrakataTicker = {
			needs: [],
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
			needs: [],
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

	it("on tickTimeoutMs: aborts the tick, counts one error, and never overlaps the next tick with the aborted one", async () => {
		const reported: string[] = [];
		const registry = makeRegistry((_id, _sp, err) => reported.push(err.message));
		let calls = 0;
		let inFlight = 0;
		let maxInFlight = 0;
		let sawAbort = false;
		const ticker: IUrakataTicker = {
			needs: [],
			id: "hang",
			description: "runs past its timeout and returns on the abort",
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
		// This tick resolves on the abort, so the registry counts one error per timed-out tick.
		expect(registry.get(u.id).errorCount).toBe(reported.length);
		expect(reported.every((m) => m.includes("exceeded 10ms"))).toBe(true);
	});

	it("stop aborts an in-flight tick, awaits its settlement, sets stoppedAt, and doesn't count an error", async () => {
		const reported: string[] = [];
		const registry = makeRegistry((_id, _sp, err) => reported.push(err.message));
		let settledAfterAbort = false;
		const ticker: IUrakataTicker = {
			needs: [],
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
		registry.register({ needs: [], id: "dup", description: "", intervalMs: 1000, tick: () => undefined });
		expect(() => registry.register({ needs: [], id: "dup", description: "", intervalMs: 1000, tick: () => undefined })).toThrow(/already registered/);
	});

	it("throws on unknown id for get/stop", async () => {
		const registry = makeRegistry();
		expect(() => registry.get("nope")).toThrow(/not found/);
		await expect(registry.stop("nope")).rejects.toThrow(/not found/);
	});

	it("`forget` stops the task and removes it, and a later lookup throws", async () => {
		const registry = makeRegistry();
		const u = registry.register({ needs: [], id: "f1", description: "", intervalMs: 1000, tick: () => undefined });
		await registry.forget(u.id);
		expect(() => registry.get(u.id)).toThrow(/not found/);
	});

	it("stopAll halts every registered urakata", async () => {
		const registry = makeRegistry();
		const ticks = vi.fn();
		registry.register({ needs: [], id: "a", description: "", intervalMs: 5, tick: ticks });
		registry.register({ needs: [], id: "b", description: "", intervalMs: 5, tick: ticks });
		await until(() => expect(ticks.mock.calls.length > 1).toBe(true));
		await registry.stopAll();
		const ticksAtStop = ticks.mock.calls.length;
		// Waits a fixed span after the stop. A wait for a state can't show that a further tick doesn't happen.
		await sleep(20);
		expect(ticks.mock.calls.length).toBe(ticksAtStop);
	});
});

describe("UrakataRegistry persistence of transitions", () => {
	const readTask = async (world: ReturnType<typeof getDefaultWorld>, id: string) => recordOf(world.shared.getStore(), URAKATA_LABEL, id);
	/** Returns a world that declares the task type, so its store reads the type's records. */
	const taskWorld = () => {
		const world = getDefaultWorld();
		world.domains = { ...world.domains, ...mapDefinitionsToDomains([urakataTaskDomainDefinition]) };
		return world;
	};

	it("persists the individual on registration, on an error and on stop, and keeps one row per id with the latest transition", async () => {
		const world = taskWorld();
		const registry = new UrakataRegistry(world, () => undefined);
		// The task fails only after the row is read at registration, so a tick that runs before that read doesn't count an error.
		let fail = false;
		const u = registry.register({
			needs: [],
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

		fail = true;
		await until(async () => expect(Number((await readTask(world, u.id))?.errorCount)).toBeGreaterThan(0));
		fail = false;
		const afterError = await readTask(world, u.id);
		expect(Number(afterError?.errorCount)).toBeGreaterThan(0);

		await registry.stop(u.id);
		await sleep(0);
		const afterStop = await readTask(world, u.id);
		expect(afterStop?.stoppedAt).toBeDefined();
	});

	it("leaves a prior instance's row unchanged, and registering its id again overwrites it with the current instance", async () => {
		const world = taskWorld();
		// Writes a row from another actuality instance whose task didn't stop cleanly.
		await world.shared
			.getStore()
			.upsertIndividual(URAKATA_LABEL, {
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
		const fresh = registry.register({ needs: [], id: "different.task", description: "new", intervalMs: 1000, tick: () => undefined });
		await sleep(0);
		const prior = await readTask(world, "imap.idle.acct/INBOX");
		expect(prior?.execution).toBe("OTHER-INSTANCE"); // untouched
		expect(prior?.stoppedAt).toBeUndefined();
		const freshRow = await readTask(world, fresh.id);
		expect(freshRow?.execution).toBe(world.tag.key);
		await registry.stopAll();

		// A restart registers the prior id again. The registration overwrites the row with the current instance and leaves
		// stoppedAt unset.
		const registry2 = new UrakataRegistry(world, () => undefined);
		registry2.register({ needs: [], id: "imap.idle.acct/INBOX", description: "restarted", intervalMs: 1000, tick: () => undefined });
		await sleep(0);
		const restarted = await readTask(world, "imap.idle.acct/INBOX");
		expect(restarted?.execution).toBe(world.tag.key);
		expect(restarted?.stoppedAt).toBeUndefined();
		await registry2.stopAll();
	});
});
