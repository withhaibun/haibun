/**
 * Urakata: step execution outside the feature flow.
 *
 * A stepper registers its tickers here and doesn't implement its own setInterval or
 * AbortController. The registry:
 *   - schedules ticks by setTimeout recursion, so a slow tick doesn't overlap the next.
 *   - gives each tick an AbortSignal. On a timeout or a stop it aborts the in-flight tick
 *     and awaits its settlement, so ticks don't overlap on any path.
 *   - wraps every tick in a try/catch, so an exception isn't left unhandled.
 *   - allocates a synthetic seqPath root per registration, so each ticker's trace has its own root.
 *   - passes the error of each failed or timed-out tick to onTickError. UrakataStepper's
 *     handler logs it as a step.failure warning.
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

import { z } from "zod";
import { NameSchema } from "./domains/domains.js";
import { allocateSyntheticSeqPath } from "./domains/host-id.js";
import { actingAs, callerHolds, restingOn, runAsTicking } from "./capability-context.js";
import { capabilityAllows } from "./actions.js";
import type { TRestsOn } from "./domains/authority-types.js";
import { getAuthority } from "./session-authority.js";
import { errorDetail } from "./util/index.js";
import type { TWorld } from "./actuality/domains/world.js";
import type { TSeqPath } from "./domains/protocol.js";
import { PersistedVertexSchema, type TDomainDefinition } from "./resources.js";

export const URAKATA = "urakata";
export const URAKATA_ID_DOMAIN = "urakata-id";
/** Persisted label for a task's transition record. Individuals are upserted by id, so one row reflects the latest transition. The event stream holds the history. */
export const URAKATA_LABEL = "Urakata";
/** The registry persists a failing ticker's first error and every Nth error after it. errorCount stays exact in memory, and stop() persists the exact count. */
const URAKATA_ERROR_PERSIST_EVERY = 10;

export const UrakataSchema = PersistedVertexSchema.extend({
	id: z.string(),
	description: z.string(),
	/** The actuality instance (world.tag.key) that ran this task. A task is running only when this equals the current instance and the task doesn't have a stoppedAt. A persisted row from another instance is never running. */
	execution: z.string(),
	seqPath: z.array(z.number()),
	startedAt: z.string(),
	lastTickAt: z.string().optional(),
	tickIndex: z.number(),
	errorCount: z.number(),
	/** stop() sets it when the task stops cleanly. In the current instance its absence means the task is running. A process that exits without a clean stop leaves it unset. A row from another instance without it records a task that ran and didn't stop cleanly. */
	stoppedAt: z.string().optional(),
	/** The identity of the caller that started the task, where the caller proved one. Each tick acts as that identity. */
	startedBy: z.string().optional(),
	/** The actions each tick holds. */
	holds: z.array(z.string()),
	/** The reason the task stopped after its starting authority lapsed. A caller's stop doesn't set it. */
	stopReason: z.string().optional(),
	/** The universal record-time field every persisted type carries. */
	generatedAtTime: z.coerce.date().default(() => new Date()),
});
export type TUrakata = z.infer<typeof UrakataSchema>;

/** The domain of a registered ticker's id. A stepper registers tickers at runtime, so the definition doesn't list the ids. */
export const urakataIdDomainDefinition: TDomainDefinition = { selectors: [URAKATA_ID_DOMAIN], schema: NameSchema, description: "Active urakata id (registered ticker)" };

export interface IUrakataTicker {
	readonly id: string;
	readonly description: string;
	readonly intervalMs: number;
	readonly tickTimeoutMs?: number;
	readonly keepAlive?: boolean;
	/**
	 * The actions each tick holds. The registry grants a tick these actions and doesn't grant others. The step that starts
	 * the ticker must hold every one of them, so a ticker never does more than its starter can.
	 */
	readonly needs: readonly string[];
	/** The signal fires when the tick exceeds tickTimeoutMs or the task stops. A tick must return promptly once the signal fires, because the registry awaits its settlement. */
	tick(ctx: { seqPath: TSeqPath; tickIndex: number; signal: AbortSignal }): void | Promise<void>;
}

export interface IUrakataRegistry {
	register(spec: IUrakataTicker): TUrakata;
	list(): readonly TUrakata[];
	get(id: string): TUrakata;
	stop(id: string): Promise<void>;
	forget(id: string): Promise<void>;
	stopAll(): Promise<void>;
}

/** Marker interface for the stepper that owns the urakata registry. It has the form of IHasCycles and IHasOptions. */
export interface IHasUrakata {
	urakata(): IUrakataRegistry;
}

interface RuntimeEntry {
	urakata: TUrakata;
	stop(): Promise<void>;
}

export class UrakataRegistry implements IUrakataRegistry {
	private entries = new Map<string, RuntimeEntry>();
	constructor(
		private world: TWorld,
		private onTickError: (urakataId: string, seqPath: TSeqPath, err: Error) => void,
	) {}

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
		let timer: NodeJS.Timeout | null = null;
		let stopped = false;
		/** The running tick's controller and settlement, or null between ticks. stop() aborts the tick through it and awaits the settlement. */
		let inflight: { controller: AbortController; settled: Promise<void> } | null = null;
		const schedule = () => {
			if (stopped) return;
			timer = setTimeout(runOnce, spec.intervalMs);
			if (!spec.keepAlive) timer.unref?.();
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
				} catch (err) {
					if (stopped && controller.signal.aborted) return;
					urakata.errorCount++;
					this.onTickError(spec.id, tickSeqPath, err instanceof Error ? err : new Error(String(err)));
					if (urakata.errorCount === 1 || urakata.errorCount % URAKATA_ERROR_PERSIST_EVERY === 0) this.persist(urakata);
				}
			});
			inflight = { controller, settled };
			if (spec.tickTimeoutMs !== undefined) {
				const timeout = timeoutHandle(spec.tickTimeoutMs);
				const outcome = await Promise.race([settled.then(() => "settled" as const), timeout.fired.then(() => "timeout" as const)]);
				if (outcome === "timeout") {
					urakata.errorCount++;
					this.onTickError(spec.id, tickSeqPath, new Error(`urakata "${spec.id}" tick exceeded ${spec.tickTimeoutMs}ms`));
					if (urakata.errorCount === 1 || urakata.errorCount % URAKATA_ERROR_PERSIST_EVERY === 0) this.persist(urakata);
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
				if (timer) clearTimeout(timer);
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
function timeoutHandle(ms: number): { fired: Promise<void>; cancel: () => void } {
	let cancel = () => undefined as void;
	const fired = new Promise<void>((resolve) => {
		const t = setTimeout(resolve, ms);
		t.unref?.();
		cancel = () => clearTimeout(t);
	});
	return { fired, cancel };
}
