/**
 * The declarations of urakata, the steps that run outside the feature flow: the record of a registered ticker, its id's domain,
 * and the ticker and registry a stepper implements and reads.
 */
import { z } from "zod";
import { NameSchema } from "./domains.js";
import { RECORDED_STATUS, type TSeqPath } from "./protocol.js";
import { PersistedVertexSchema, type TDomainDefinition } from "./resources.js";
import { ENDED_BY_FIELD, ACTUALITY_FIELD } from "../actuality/domains/seq-path.js";

export const URAKATA = "urakata";
export const URAKATA_ID_DOMAIN = "urakata-id";
/** Persisted label for a task's transition record. Individuals are upserted by id, so one row reflects the latest transition. The event stream holds the history. */
export const URAKATA_LABEL = "Urakata";

export const UrakataSchema = PersistedVertexSchema.extend({
	id: z.string(),
	description: z.string(),
	/** The actuality instance (world.tag.key) that ran this task. A persisted row from another instance is never running. */
	[ACTUALITY_FIELD]: z.string(),
	seqPath: z.array(z.number()),
	startedAt: z.string(),
	lastTickAt: z.string().optional(),
	tickIndex: z.number(),
	errorCount: z.number(),
	/** How the task stands: running from its registration, stopped where stop() stopped it, and interrupted where its process
	 *  ended first, which the next start of the store states. */
	actionStatus: z.enum(RECORDED_STATUS),
	/** stop() sets it when the task stops cleanly. A process that exits without a clean stop leaves it unset, and the next start
	 *  of the store sets it to the latest time a record of that process states. */
	stoppedAt: z.string().optional(),
	/** The record of the start-up step that ended the task as interrupted. */
	[ENDED_BY_FIELD]: z.string().optional(),
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
