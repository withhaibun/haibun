/**
 * Urakata — out-of-band step execution that lives outside the feature flow.
 *
 * Tickers register here instead of each stepper rolling its own setInterval /
 * AbortController. The registry:
 *   - schedules ticks via setTimeout-recursion (no overlap when a tick is slow),
 *   - gives each tick an AbortSignal; a timeout or a stop aborts the in-flight
 *     tick and awaits its settlement, so no-overlap holds on every path,
 *   - wraps every tick in a per-instance try/catch (no unhandled exceptions),
 *   - allocates a synthetic seqPath root per registration (traces scope cleanly),
 *   - emits structured step.failure events when ticks throw (autonomic visibility),
 *   - stops everything on endFeature(shouldClose) and process signals.
 *
 * Implementing steppers expose IUrakataTicker classes that carry their own state
 * and a tick method — the registry composes them. A long-lived task is a ticker
 * whose tick blocks (honouring the signal) until there is work or the signal fires.
 *
 * State is derived, never stored as a claim about the present: a live entry with
 * no stoppedAt is running; stop() records stoppedAt. A persisted snapshot carries
 * only these past-tense facts, so it cannot outlive its truth.
 */

import { z } from "zod";
import { allocateSyntheticSeqPath } from "./host-id.js";
import type { TWorld } from "./world.js";
import type { TSeqPath } from "../schema/protocol.js";
import type { TDomainDefinition } from "./resources.js";

export const URAKATA = "urakata";
export const URAKATA_ID_DOMAIN = "urakata-id";
/** Persisted label for a task's transition record. Individuals are upserted by id, so one row reflects the latest transition; history lives in the event stream. */
export const URAKATA_LABEL = "Urakata";

export const UrakataSchema = z.object({
	id: z.string(),
	description: z.string(),
	/** The run instance this task ran in (world.tag.key). A view says "running" only when this equals the current instance and there is no stoppedAt; a persisted row from another instance can never claim the present. */
	execution: z.string(),
	seqPath: z.array(z.number()),
	startedAt: z.string(),
	lastTickAt: z.string().optional(),
	tickIndex: z.number(),
	errorCount: z.number(),
	/** Set once, when the task is cleanly stopped. Its absence is what "running" means; a killed process leaves it absent, which reads as "ran, not cleanly stopped" — never as a false "running". */
	stoppedAt: z.string().optional(),
	/** The universal record-time field every persisted type carries. */
	generatedAtTime: z.coerce.date().default(() => new Date()),
});
export type TUrakata = z.infer<typeof UrakataSchema>;

/** Runtime-valued domain — SPA pulls current ids via getSelectValues so step parameters get a dropdown. */
export const urakataIdDomainDefinition: TDomainDefinition = {
	selectors: [URAKATA_ID_DOMAIN],
	schema: z.string().min(1),
	description: "Active urakata id (registered ticker)",
};

export interface IUrakataTicker {
	readonly id: string;
	readonly description: string;
	readonly intervalMs: number;
	readonly tickTimeoutMs?: number;
	readonly keepAlive?: boolean;
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
		};
		this.entries.set(spec.id, this.startTicker(spec, urakata));
		this.persist(urakata);
		return urakata;
	}

	/**
	 * Materialize a task's current state as a persisted individual (upsert by id). Transitions only — registration, a
	 * stop, an error-count change — never per tick. Writes through the store behind world.shared, so the built-in
	 * in-memory store works for tests and a registered backing makes it durable. A persistence failure is surfaced,
	 * not swallowed, and never breaks the task.
	 */
	private persist(urakata: TUrakata): void {
		const store = this.world.shared?.getStore();
		if (!store) return;
		void store.upsertIndividual(URAKATA_LABEL, { ...urakata }).catch((err: unknown) => {
			this.world.eventLogger.warn(`[urakata] could not persist "${urakata.id}": ${err instanceof Error ? err.message : String(err)}`);
		});
	}

	private startTicker(spec: IUrakataTicker, urakata: TUrakata): RuntimeEntry {
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
			const settled: Promise<void> = (async () => {
				try {
					await Promise.resolve(spec.tick({ seqPath: tickSeqPath, tickIndex: urakata.tickIndex - 1, signal: controller.signal }));
				} catch (err) {
					if (stopped && controller.signal.aborted) return;
					urakata.errorCount++;
					this.onTickError(spec.id, tickSeqPath, err instanceof Error ? err : new Error(String(err)));
					this.persist(urakata);
				}
			})();
			inflight = { controller, settled };
			if (spec.tickTimeoutMs !== undefined) {
				const timeout = timeoutHandle(spec.tickTimeoutMs);
				const outcome = await Promise.race([settled.then(() => "settled" as const), timeout.fired.then(() => "timeout" as const)]);
				if (outcome === "timeout") {
					urakata.errorCount++;
					this.onTickError(spec.id, tickSeqPath, new Error(`urakata "${spec.id}" tick exceeded ${spec.tickTimeoutMs}ms`));
					this.persist(urakata);
					controller.abort();
					// Await the tick's actual settlement (its own catch will swallow the abort as a normal end) so the next
					// tick never overlaps the aborted one. The single error above is the tick's one recorded outcome.
					await settled.catch((): void => undefined);
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
					await inflight.settled.catch((): void => undefined);
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
