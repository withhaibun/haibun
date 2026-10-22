/**
 * Urakata: step execution outside the feature flow.
 *
 * A stepper registers its tickers here and doesn't implement its own timer or
 * AbortController. The registry:
 *   - schedules each tick after the one before it settles, through the world's clock, so a slow tick doesn't overlap the next.
 *   - gives each tick an AbortSignal. On a timeout or a stop it aborts the in-flight tick
 *     and awaits its settlement, so ticks don't overlap on any path.
 *   - wraps every tick in a try/catch, so an exception isn't left unhandled.
 *   - allocates a synthetic seqPath root per registration, so each ticker's trace has its own root.
 *   - reports a task's failing ticks once as they start failing, with the first error, and once as a tick succeeds again,
 *     with how many failed. UrakataStepper's reporter logs the start as a step.failure warning.
 *
 * UrakataStepper calls stopAll() on endFeature(shouldClose). A ticker's timer doesn't hold the
 * process open unless the ticker sets keepAlive.
 *
 * Steppers implement IUrakataTicker classes that hold their own state and a tick method.
 * The registry schedules them. A long-lived task is a ticker whose tick blocks until there
 * is work or the signal fires.
 *
 * The registry doesn't store a running state. A live entry without a stoppedAt is running,
 * and stop() records stoppedAt. A persisted row records only past transitions, so it stays
 * accurate after its process ends.
 */

import { allocateSyntheticSeqPath } from "../domains/host-id.js";
import { releaseSeqPaths } from "../actuality/pipelines/step-dispatch.js";
import { actingAs, callerHolds, restingOn, runAsTicking } from "../domains/capability-context.js";
import { capabilityAllows } from "../domains/actions.js";
import type { TRestsOn } from "../domains/authority-types.js";
import { getAuthority } from "../domains/session-authority.js";
import { URAKATA_LABEL, type IUrakataRegistry, type IUrakataTicker, type TUrakata } from "../domains/urakata.js";
import { errorDetail } from "../domains/util.js";
import type { TWorld } from "../actuality/domains/world.js";
import type { TClock } from "../actuality/ports.js";
import type { TSeqPath } from "../domains/protocol.js";
import { Conditions, type THeldCondition } from "../machines/conditions.js";

/** The registry persists a failing ticker's first error and every Nth error after it. errorCount stays exact in memory, and stop() persists the exact count. */
const URAKATA_ERROR_PERSIST_EVERY = 10;
/** The most tasks whose failing the registry holds at once, one per registered task. */
const FAILING_TASKS_HELD = 1_000;

/** Receives a task's failing ticks: `failed` as they start, with the first error, and `recovered` as a tick succeeds after
 *  them, with what the failing held. A tick that fails while the task fails already counts and isn't reported. */
export type TTickReporter = { failed(urakataId: string, seqPath: TSeqPath, err: Error): void; recovered(urakataId: string, seqPath: TSeqPath, held: THeldCondition): void };

interface RuntimeEntry {
	urakata: TUrakata;
	stop(): Promise<void>;
}

export class UrakataRegistry implements IUrakataRegistry {
	private entries = new Map<string, RuntimeEntry>();
	private readonly failing = new Conditions(FAILING_TASKS_HELD);
	constructor(
		private world: TWorld,
		private reporter: TTickReporter,
	) {}

	/** Counts a failed tick, persists the task's first error and every Nth, and reports the error where the task starts failing. */
	private tickFailed(urakata: TUrakata, seqPath: TSeqPath, err: Error): void {
		urakata.errorCount++;
		if (this.failing.occurs(urakata.id, err.message, this.world.clock.now())) this.reporter.failed(urakata.id, seqPath, err);
		if (urakata.errorCount === 1 || urakata.errorCount % URAKATA_ERROR_PERSIST_EVERY === 0) this.persist(urakata);
	}

	/** Reports a task's recovery where a tick succeeds after failing ticks. */
	private tickHeld(urakata: TUrakata, seqPath: TSeqPath): void {
		const ended = this.failing.ends(urakata.id);
		if (ended !== undefined) this.reporter.recovered(urakata.id, seqPath, ended);
	}

	register(spec: IUrakataTicker): TUrakata {
		if (this.entries.has(spec.id)) throw new Error(`an urakata of id "${spec.id}" is already registered; stop it or register another id`);
		// The registry checks the starting step here once, so a missing action fails at the start rather than on every tick.
		// Outside a dispatch callerHolds() returns undefined, and the check passes. A feature statement of actuality holds
		// RUN_AUTHORITY, which allows every action.
		const held = callerHolds();
		const missing = held === undefined ? [] : spec.needs.filter((action) => !capabilityAllows(held, action));
		if (missing.length > 0) {
			throw new Error(`Can't start ${spec.description}: it needs ${missing.join(", ")}, which the caller doesn't hold. Delegate ${missing.join(", ")} to the key that starts it.`);
		}
		const seqPath = allocateSyntheticSeqPath(this.world);
		const urakata: TUrakata = {
			id: spec.id,
			description: spec.description,
			execution: this.world.tag.key,
			seqPath,
			startedAt: new Date().toISOString(),
			tickIndex: 0,
			errorCount: 0,
			generatedAtTime: new Date(),
			startedBy: actingAs(),
			holds: [...spec.needs],
		};
		const restsOn = restingOn();
		this.entries.set(spec.id, this.startTicker(spec, urakata, restsOn));
		if (restsOn) this.stopWhenLapsed(urakata, restsOn);
		this.persist(urakata);
		return urakata;
	}

	/**
	 * Upserts a task's current state by id as a persisted individual. It runs on each transition: a registration, a stop,
	 * the first error and every Nth error. It doesn't run per tick. It writes to the store that world.shared.getStore()
	 * returns, so tests use the built-in in-memory store and a registered backing store makes the record durable. A
	 * persistence failure is logged as a warning and doesn't stop the task.
	 */
	private persist(urakata: TUrakata): void {
		const store = this.world.shared?.getStore();
		if (!store) return;
		void store.upsertIndividual(URAKATA_LABEL, { ...urakata }).catch((err: unknown) => {
			this.world.eventLogger.warn(`[urakata] could not persist "${urakata.id}": ${errorDetail(err)}`);
		});
	}

	/** Stops a task once the authority its starter proved lapses. The authority lapses when a capability the proof rests
	 *  on is revoked or its expiry passes. A task that actuality's own statements started doesn't rest on a proof. */
	private stopWhenLapsed(urakata: TUrakata, restsOn: TRestsOn): void {
		const held = getAuthority(this.world.runtime)?.holdWhile(restsOn);
		if (!held) return;
		const lapsed = () => {
			urakata.stopReason = String(held.signal.reason);
			this.world.eventLogger.warn(`[urakata] stopped "${urakata.id}": ${urakata.stopReason}`);
			void this.entries.get(urakata.id)?.stop();
		};
		if (held.signal.aborted) lapsed();
		else held.signal.addEventListener("abort", lapsed, { once: true });
		const entry = this.entries.get(urakata.id);
		if (entry) this.entries.set(urakata.id, { ...entry, stop: () => entry.stop().finally(held.release) });
	}

	private startTicker(spec: IUrakataTicker, urakata: TUrakata, restsOn: TRestsOn | undefined): RuntimeEntry {
		let cancel: (() => void) | null = null;
		let stopped = false;
		/** The running tick's controller and settlement, or null between ticks. stop() aborts the tick through it and awaits the settlement. */
		let inflight: { controller: AbortController; settled: Promise<void> } | null = null;
		const schedule = () => {
			if (stopped) return;
			cancel = this.world.clock.after(spec.intervalMs, () => void runOnce(), spec.keepAlive === true);
		};
		const runOnce = async (): Promise<void> => {
			const tickSeqPath = [...urakata.seqPath, urakata.tickIndex];
			urakata.lastTickAt = new Date().toISOString();
			urakata.tickIndex++;
			const controller = new AbortController();
			// settled resolves after the registry records the tick's outcome, so stop() and the timeout await a consistent
			// state. A tick that stop() aborts ends normally and doesn't count as an error. A tick holds its ticker's needs,
			// reads at the access ceiling those actions grant, and acts as its starter. It doesn't inherit the actions the
			// starting step held through the async context. That context lasts for the life of the process and would grant
			// a tick more than its work requires.
			const settled: Promise<void> = runAsTicking(spec.needs, urakata.startedBy, restsOn, async () => {
				try {
					await Promise.resolve(spec.tick({ seqPath: tickSeqPath, tickIndex: urakata.tickIndex - 1, signal: controller.signal }));
					if (!controller.signal.aborted) this.tickHeld(urakata, tickSeqPath);
				} catch (err) {
					if (stopped && controller.signal.aborted) return;
					this.tickFailed(urakata, tickSeqPath, err instanceof Error ? err : new Error(String(err)));
				} finally {
					releaseSeqPaths(this.world, tickSeqPath);
				}
			});
			inflight = { controller, settled };
			if (spec.tickTimeoutMs !== undefined) {
				const timeout = timeoutHandle(this.world.clock, spec.tickTimeoutMs);
				const outcome = await Promise.race([settled.then(() => "settled" as const), timeout.fired.then(() => "timeout" as const)]);
				if (outcome === "timeout") {
					this.tickFailed(urakata, tickSeqPath, new Error(`urakata "${spec.id}" tick exceeded ${spec.tickTimeoutMs}ms`));
					controller.abort();
					// Awaits the tick's settlement so the next tick never overlaps the aborted one. settled never rejects,
					// because its body catches every error. The timeout counts one error. The registry counts a second error
					// when the aborted tick rejects, because only a stop() abort is exempt.
					await settled;
				} else {
					timeout.cancel();
				}
			} else {
				await settled;
			}
			inflight = null;
			schedule();
		};
		schedule();
		return {
			urakata,
			stop: async (): Promise<void> => {
				stopped = true;
				cancel?.();
				if (inflight) {
					inflight.controller.abort();
					await inflight.settled;
				}
				urakata.stoppedAt = new Date().toISOString();
				this.persist(urakata);
			},
		};
	}

	list(): readonly TUrakata[] {
		// Returns snapshots. A later `stop`, `forget` or errorCount increment doesn't change an array already returned.
		return [...this.entries.values()].map((e) => ({ ...e.urakata }));
	}

	get(id: string): TUrakata {
		const e = this.entries.get(id);
		if (!e) throw new Error(`an urakata of id "${id}" isn't registered; list urakata to read the ids registered`);
		return e.urakata;
	}

	async stop(id: string): Promise<void> {
		const e = this.entries.get(id);
		if (!e) throw new Error(`an urakata of id "${id}" isn't registered; list urakata to read the ids registered`);
		await e.stop();
	}

	async forget(id: string): Promise<void> {
		await this.stop(id);
		this.entries.delete(id);
	}

	async stopAll(): Promise<void> {
		const stops = [...this.entries.values()].map((e) => e.stop());
		await Promise.all(stops);
	}
}

/** A timer whose `fired` promise resolves when the interval elapses and never rejects. The caller calls `cancel` to clear the timer when the tick settles first. */
function timeoutHandle(clock: TClock, ms: number): { fired: Promise<void>; cancel: () => void } {
	let cancel = () => undefined as void;
	const fired = new Promise<void>((resolve) => {
		cancel = clock.after(ms, resolve, false);
	});
	return { fired, cancel };
}
