/**
 * Urakata: out-of-band step execution that lives outside the feature flow.
 *
 * Tickers register here instead of each stepper rolling its own setInterval /
 * AbortController. The registry:
 *   - schedules ticks via setTimeout-recursion (ticks don't overlap when a tick is slow),
 *   - gives each tick an AbortSignal; a timeout or a stop aborts the in-flight
 *     tick and awaits its settlement, so no-overlap holds on every path,
 *   - wraps every tick in a per-instance try/catch (so an exception isn't left unhandled),
 *   - allocates a synthetic seqPath root per registration (traces scope cleanly),
 *   - emits structured step.failure events when ticks throw (autonomic visibility),
 *   - stops everything on endFeature(shouldClose) and process signals.
 *
 * Implementing steppers expose IUrakataTicker classes that carry their own state
 * and a tick method: the registry composes them. A long-lived task is a ticker
 * whose tick blocks (honouring the signal) until there is work or the signal fires.
 *
 * State is derived, never stored as a claim about the present: a live entry without
 * a stoppedAt is running; stop() records stoppedAt. A persisted snapshot carries
 * only these past-tense facts, so it cannot outlive its truth.
 */

import { z } from "zod";
import { NameSchema } from "./domains.js";
import { allocateSyntheticSeqPath } from "./host-id.js";
import { actingAs, authorizedWith, restingOn, runAsTicking } from "./capability-context.js";
import { capabilityAllows } from "./actions.js";
import type { TRestsOn } from "./authority-types.js";
import { getAuthority } from "./session-authority.js";
import { errorDetail } from "./util/index.js";
import type { TWorld } from "./world.js";
import type { TSeqPath } from "../schema/protocol.js";
import { PersistedVertexSchema, type TDomainDefinition } from "./resources.js";

export const URAKATA = "urakata";
export const URAKATA_ID_DOMAIN = "urakata-id";
/** Persisted label for a task's transition record. Individuals are upserted by id, so one row reflects the latest transition; history lives in the event stream. */
export const URAKATA_LABEL = "Urakata";
/** A persistently failing ticker persists its first error, then every Nth, errorCount stays exact in memory and is persisted exactly at stop. */
const URAKATA_ERROR_PERSIST_EVERY = 10;

export const UrakataSchema = PersistedVertexSchema.extend({
	id: z.string(),
	description: z.string(),
	/** Actuality instance this task ran in (world.tag.key). A view reports "running" only when this equals the current instance and it doesn't have a stoppedAt; a persisted row from another instance can never claim the present. */
	execution: z.string(),
	seqPath: z.array(z.number()),
	startedAt: z.string(),
	lastTickAt: z.string().optional(),
	tickIndex: z.number(),
	errorCount: z.number(),
	/** Set once, when the task is cleanly stopped. Its absence is what "running" means; a killed process leaves it absent, which reads as "ran, not cleanly stopped", never as a false "running". */
	stoppedAt: z.string().optional(),
	/** Who started the task, where a caller proved itself; each tick acts for them. */
	startedBy: z.string().optional(),
	/** What each tick does its work with. */
	holds: z.array(z.string()),
	/** Why the task stopped where it wasn't stopped by a caller: the authority it was started under lapsed. */
	stopReason: z.string().optional(),
	/** The universal record-time field every persisted type carries. */
	generatedAtTime: z.coerce.date().default(() => new Date()),
});
export type TUrakata = z.infer<typeof UrakataSchema>;

/** Runtime-valued domain, SPA pulls current ids via getSelectValues so step parameters get a dropdown. */
export const urakataIdDomainDefinition: TDomainDefinition = {
	selectors: [URAKATA_ID_DOMAIN],
	schema: NameSchema,
	description: "Active urakata id (registered ticker)",
};

export interface IUrakataTicker {
	readonly id: string;
	readonly description: string;
	readonly intervalMs: number;
	readonly tickTimeoutMs?: number;
	readonly keepAlive?: boolean;
	/**
	 * What each tick does its work with, which the registry grants it and no more. The step that starts the ticker must
	 * hold every one of these, so a ticker never does more than whoever started it.
	 */
	readonly needs: readonly string[];
	/** The signal fires when the tick exceeds tickTimeoutMs or the task is stopped; a well-behaved tick returns promptly once it fires. */
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

/** Marker interface for the stepper that owns the urakata registry. Mirrors IHasCycles / IHasOptions. */
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
		if (this.entries.has(spec.id)) throw new Error(`urakata id "${spec.id}" already registered`);
		// The step that starts a ticker is checked once, here, so a missing action fails where it is started and not on
		// every tick. A statement of actuality's own run isn't bounded by a capability, and holds what its ticker needs.
		const held = authorizedWith();
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
	 * Materialize a task's current state as a persisted individual (upsert by id). Transitions only, registration, a
	 * stop, an error-count change, never per tick. Writes through the store behind world.shared, so the built-in
	 * in-memory store works for tests and a registered backing makes it durable. A persistence failure is surfaced,
	 * not discarded, and never breaks the task.
	 */
	private persist(urakata: TUrakata): void {
		const store = this.world.shared?.getStore();
		if (!store) return;
		void store.upsertIndividual(URAKATA_LABEL, { ...urakata }).catch((err: unknown) => {
			this.world.eventLogger.warn(`[urakata] could not persist "${urakata.id}": ${errorDetail(err)}`);
		});
	}

	/** Stop a task once the authority its starter proved lapses: a capability that proof rests on is revoked, or its
	 *  expiry passes. A task started by actuality's own statements doesn't rest on a proof. */
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
		/** The controller of the currently running tick, or null between ticks. stop()/timeout abort through it. */
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
			// A tick settling and the registry counting its outcome are one flow: settled resolves once the count is
			// recorded, so stop()/timeout can await a clean state. A tick aborted by stop() is a normal end, not an error.
			// A tick holds what its ticker needs, reads at the ceiling that grants, and acts for whoever started it. It
			// doesn't keep what the starting step held through the async context: that lasts for the life of the process,
			// and would give a tick more than its work takes.
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
					// Await the tick's actual settlement (settled never rejects: its body is fully caught; the abort ends as
					// a normal settle) so the next tick never overlaps the aborted one. The single error above is the tick's
					// one recorded outcome.
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
		// Returned values are snapshots: later registry mutations (stop, forget, errorCount++)
		// do not retroactively change an already-returned array.
		return [...this.entries.values()].map((e) => ({ ...e.urakata }));
	}

	get(id: string): TUrakata {
		const e = this.entries.get(id);
		if (!e) throw new Error(`urakata "${id}" not found`);
		return e.urakata;
	}

	async stop(id: string): Promise<void> {
		const e = this.entries.get(id);
		if (!e) throw new Error(`urakata "${id}" not found`);
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

/** A timer whose `fired` promise resolves (never rejects) when the interval elapses, and which can be cancelled if the race is won first. */
function timeoutHandle(ms: number): { fired: Promise<void>; cancel: () => void } {
	let cancel = () => undefined as void;
	const fired = new Promise<void>((resolve) => {
		const t = setTimeout(resolve, ms);
		t.unref?.();
		cancel = () => clearTimeout(t);
	});
	return { fired, cancel };
}
