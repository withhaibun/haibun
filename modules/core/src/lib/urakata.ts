/**
 * Urakata — out-of-band step execution that lives outside the feature flow.
 *
 * Tickers (periodic) and watchers (long-lived async) register here instead of
 * each stepper rolling its own setInterval / AbortController. The registry:
 *   - schedules ticks via setTimeout-recursion (no overlap when a tick is slow),
 *   - wraps every tick in a per-instance try/catch (no unhandled exceptions),
 *   - allocates a synthetic seqPath root per registration (traces scope cleanly),
 *   - emits structured step.failure events when ticks throw (autonomic visibility),
 *   - stops everything on endFeature(shouldClose) and process signals.
 *
 * Implementing steppers expose IUrakataTicker / IUrakataWatcher classes that
 * carry their own state and tick/run methods — the registry composes them.
 */

import { z } from "zod";
import { allocateSyntheticSeqPath } from "./host-id.js";
import type { TWorld } from "./execution.js";
import type { TSeqPath } from "../schema/protocol.js";
import type { TDomainDefinition } from "./resources.js";

export const URAKATA = "urakata";
export const URAKATA_ID_DOMAIN = "urakata-id";

export const UrakataSchema = z.object({
	id: z.string(),
	kind: z.enum(["ticker", "watcher"]),
	description: z.string(),
	seqPath: z.array(z.number()),
	startedAt: z.string(),
	lastTickAt: z.string().optional(),
	tickIndex: z.number(),
	errorCount: z.number(),
	status: z.enum(["running", "stopped"]),
});
export type TUrakata = z.infer<typeof UrakataSchema>;

/** Runtime-valued domain — SPA pulls current ids via getSelectValues so step parameters get a dropdown. */
export const urakataIdDomainDefinition: TDomainDefinition = {
	selectors: [URAKATA_ID_DOMAIN],
	schema: z.string().min(1),
	description: "Active urakata id (registered ticker or watcher)",
};

export interface IUrakataTicker {
	readonly id: string;
	readonly description: string;
	readonly intervalMs: number;
	readonly tickTimeoutMs?: number;
	readonly keepAlive?: boolean;
	tick(ctx: { seqPath: TSeqPath; tickIndex: number }): void | Promise<void>;
}

export interface IUrakataWatcher {
	readonly id: string;
	readonly description: string;
	run(ctx: { seqPath: TSeqPath; signal: AbortSignal }): Promise<void>;
}

export interface IUrakataRegistry {
	register(spec: IUrakataTicker | IUrakataWatcher): TUrakata;
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

function isTicker(spec: IUrakataTicker | IUrakataWatcher): spec is IUrakataTicker {
	return typeof (spec as IUrakataTicker).intervalMs === "number";
}

export class UrakataRegistry implements IUrakataRegistry {
	private entries = new Map<string, RuntimeEntry>();
	constructor(
		private world: TWorld,
		private onTickError: (urakataId: string, seqPath: TSeqPath, err: Error) => void,
	) {}

	register(spec: IUrakataTicker | IUrakataWatcher): TUrakata {
		if (this.entries.has(spec.id)) throw new Error(`urakata id "${spec.id}" already registered`);
		const seqPath = allocateSyntheticSeqPath(this.world);
		const urakata: TUrakata = {
			id: spec.id,
			kind: isTicker(spec) ? "ticker" : "watcher",
			description: spec.description,
			seqPath,
			startedAt: new Date().toISOString(),
			tickIndex: 0,
			errorCount: 0,
			status: "running",
		};
		const entry: RuntimeEntry = isTicker(spec) ? this.startTicker(spec, urakata) : this.startWatcher(spec, urakata);
		this.entries.set(spec.id, entry);
		return urakata;
	}

	private startTicker(spec: IUrakataTicker, urakata: TUrakata): RuntimeEntry {
		let timer: NodeJS.Timeout | null = null;
		let stopped = false;
		const schedule = () => {
			if (stopped) return;
			timer = setTimeout(runOnce, spec.intervalMs);
			if (!spec.keepAlive) timer.unref?.();
		};
		const runOnce = async () => {
			const tickSeqPath = [...urakata.seqPath, urakata.tickIndex];
			urakata.lastTickAt = new Date().toISOString();
			urakata.tickIndex++;
			try {
				const tickPromise = Promise.resolve(spec.tick({ seqPath: tickSeqPath, tickIndex: urakata.tickIndex - 1 }));
				if (spec.tickTimeoutMs) {
					await Promise.race([tickPromise, timeoutAfter(spec.tickTimeoutMs, `urakata "${spec.id}" tick exceeded ${spec.tickTimeoutMs}ms`)]);
				} else {
					await tickPromise;
				}
			} catch (err) {
				urakata.errorCount++;
				this.onTickError(spec.id, tickSeqPath, err instanceof Error ? err : new Error(String(err)));
			}
			schedule();
		};
		schedule();
		return {
			urakata,
			stop: () =>
				new Promise<void>((resolve) => {
					stopped = true;
					if (timer) clearTimeout(timer);
					urakata.status = "stopped";
					resolve();
				}),
		};
	}

	private startWatcher(spec: IUrakataWatcher, urakata: TUrakata): RuntimeEntry {
		const controller = new AbortController();
		const completion = (async () => {
			try {
				await spec.run({ seqPath: urakata.seqPath, signal: controller.signal });
			} catch (err) {
				if (controller.signal.aborted) return;
				urakata.errorCount++;
				this.onTickError(spec.id, urakata.seqPath, err instanceof Error ? err : new Error(String(err)));
			}
		})();
		return {
			urakata,
			stop: async () => {
				controller.abort();
				urakata.status = "stopped";
				await completion;
			},
		};
	}

	list(): readonly TUrakata[] {
		// Returned values are snapshots: subsequent registry mutations (stop, forget, errorCount++)
		// do not retroactively change a previously-listed array.
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

function timeoutAfter(ms: number, message: string): Promise<never> {
	return new Promise((_, reject) => {
		const t = setTimeout(() => reject(new Error(message)), ms);
		t.unref?.();
	});
}
