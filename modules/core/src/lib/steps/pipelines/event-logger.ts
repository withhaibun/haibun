/**
 * The events hub. Every event of actuality is emitted through it once: the hub states the event's access level, obscures
 * the secret values it states, delivers it to each subscriber of its kind, and writes its serialized form to the sink.
 */
import { errorDetail } from "../../util/index.js";
import { HAIBUN_LOG_LEVELS, LogEvent, LifecycleEvent, STATUS, stepLevel } from "../../../schema/protocol.js";
import type { THaibunEvent, TArtifactEvent, THaibunLogLevel, TEventKind, TStepEnd } from "../../../schema/protocol.js";
import type { TFeatureStep } from "../domains/stepper.js";
import { sanitizeObjectSecrets } from "../../util/secret-utils.js";
import { formatSeqPath } from "../../seq-path.js";
import { failFastOrLog } from "../../dev-mode.js";
import { stepInFlight, writeBound } from "../../capability-context.js";
import { writtenAt } from "../../actions.js";
import { Access } from "../../resources.js";
import type { IEventLogger, TEventSink, TEventSubscriber, TSecrets, TSubscribeOptions } from "../ports.js";
import { obscuredEvent } from "../derivations/obscured.js";
import { serializedEvent } from "../derivations/serialized-event.js";

/** The narrated kinds. The sink writes them, and a subscribe(cb) without options receives them. A blip isn't narrated.
 *  Only a subscriber that lists the blip kind receives a blip, so the monitor's buffer and SSE receive per-frame blips
 *  only where they list that kind. */
const NARRATED_KINDS: ReadonlySet<TEventKind> = new Set<TEventKind>(["lifecycle", "log", "artifact", "control"]);

/** The level an event is written at where it doesn't state one and a ceiling doesn't bound the call that emits it. An
 *  event of actuality holds its steps, logs and records, so it is private. */
const EVENT_LEVEL = Access.private;

/** The level a log statement keeps whatever the level of the step in flight: a warning or an error. */
const UNCAPPED_LEVEL: THaibunLogLevel = "warn";

/** The kinds a subscriber receives: the kinds it lists, or the narrated kinds where it doesn't list any. */
const receivedKinds = (kinds: ReadonlySet<TEventKind> | undefined): ReadonlySet<TEventKind> => (kinds === undefined ? NARRATED_KINDS : kinds);

const matchesName = (names: readonly string[], name: string) => names.some((n) => name === n || name.startsWith(`${n}.`));

type THeldSubscriber = { callback: TEventSubscriber; kinds: ReadonlySet<TEventKind> | undefined; names: readonly string[] | undefined };

export class EventLogger implements IEventLogger {
	private subscribers: THeldSubscriber[] = [];
	private kindCounts = new Map<TEventKind, number>();
	public suppressConsole = false;

	/** `secrets` states what an event may hold that the hub obscures. `sink` writes each narrated event. `ndjsonForced` is
	 *  true when NDJSON output of events was requested. A process reads that output, and it requires every event while a
	 *  monitor formats the console, so ndjsonForced takes precedence over the monitor's console suppression. */
	constructor(
		private readonly secrets: TSecrets,
		private readonly sink: TEventSink,
		public readonly ndjsonForced: boolean,
	) {}

	/** Without options, delivers every narrated kind and never a blip. `{ kinds }` delivers those kinds only, and is the
	 *  only way to receive `"blip"`. `{ names }` narrows the blips to a declared name or dotted namespace. */
	subscribe(callback: TEventSubscriber, options?: TSubscribeOptions): void {
		if (options?.names && !options.kinds?.includes("blip")) throw new Error(`subscribe: names filters blips, and the subscription doesn't list the blip kind; include kinds: ["blip"]`);
		const kinds = options?.kinds ? new Set(options.kinds) : undefined;
		this.subscribers.push({ callback, kinds, names: options?.names });
		for (const kind of receivedKinds(kinds)) this.kindCounts.set(kind, this.countOf(kind) + 1);
	}

	unsubscribe(callback: TEventSubscriber): void {
		for (const held of this.subscribers.filter((s) => s.callback === callback))
			for (const kind of receivedKinds(held.kinds)) {
				const count = this.countOf(kind) - 1;
				if (count > 0) this.kindCounts.set(kind, count);
				else this.kindCounts.delete(kind);
			}
		this.subscribers = this.subscribers.filter((s) => s.callback !== callback);
	}

	/** The count of subscribers that receive events of a kind. */
	private countOf(kind: TEventKind): number {
		const count = this.kindCounts.get(kind);
		return count === undefined ? 0 : count;
	}

	private wouldReceive(sub: THeldSubscriber, kind: TEventKind, name: string | undefined): boolean {
		if (sub.kinds ? !sub.kinds.has(kind) : !NARRATED_KINDS.has(kind)) return false;
		return !sub.names || name === undefined || matchesName(sub.names, name);
	}

	/** Returns whether a subscriber would receive an event of this kind. With a blip's declared name, it also checks that a
	 *  subscriber's filter matches the name. recordBlip calls it first and returns where it is false. */
	hasSubscribers(kind: TEventKind, name?: string): boolean {
		if (!this.kindCounts.has(kind)) return false;
		return name === undefined || this.subscribers.some((s) => this.wouldReceive(s, kind, name));
	}

	emit(event: THaibunEvent): void {
		const narrated = NARRATED_KINDS.has(event.kind);
		if (!narrated && !this.kindCounts.has(event.kind)) return;
		const name = event.kind === "blip" ? event.name : undefined;
		// Every event states the access level of what it reveals, so a follower receives only the events it may read.
		// writtenAt determines an event's level, as it does a record's. An event that doesn't state a level takes the read
		// ceiling of the call that emits it. Outside a bounded call, such an event is actuality's own and takes the events'
		// declared level. An event that states a level more public than the ceiling throws, unless the call holds that level's
		// write action. The event is obscured once, so every subscriber and the sink receive the same obscured event.
		const stated = obscuredEvent({ ...event, accessLevel: writtenAt(event.accessLevel, EVENT_LEVEL, writeBound()) }, this.secrets.values());
		for (const sub of this.subscribers) {
			if (!this.wouldReceive(sub, event.kind, name)) continue;
			try {
				sub.callback(stated);
			} catch (e) {
				// failFastOrLog logs a subscriber's error in PROD, so delivery to the other subscribers continues, as in
				// StreamListeners.dispatch. In DEV it throws the error again.
				failFastOrLog("an event subscriber threw while it received an event:", e);
			}
		}
		if (narrated && !this.suppressConsole) this.sink.write(serializedEvent(stated));
	}

	log(featureStep: TFeatureStep, level: THaibunLogLevel, message: string, attributes?: Record<string, unknown>): void {
		this.emit(LogEvent.parse({ id: formatSeqPath(featureStep.seqPath), timestamp: Date.now(), kind: "log", level: this.reportedAt(level), message, attributes }));
	}

	info(message: string, attributes?: Record<string, unknown>): void {
		this.emitLog("info", message, attributes);
	}

	debug(message: string, attributes?: Record<string, unknown>): void {
		this.emitLog("debug", message, attributes);
	}

	warn(message: string, attributes?: Record<string, unknown>): void {
		this.emitLog("warn", message, attributes);
	}

	error(message: string, attributes?: Record<string, unknown>): void {
		this.emitLog("error", message, attributes);
	}

	private emitLog(level: THaibunLogLevel, message: string, attributes: Record<string, unknown> | undefined): void {
		const seqPath = stepInFlight()?.seqPath;
		const id = seqPath ? `${seqPath}.log.${Date.now()}` : `log.${Date.now()}`;
		this.emit(LogEvent.parse({ id, timestamp: Date.now(), kind: "log", level: this.reportedAt(level), message, attributes }));
	}

	/** Returns the level of a log statement: its own level, capped at the level of the step in flight. A warning or an
	 *  error keeps its own level, so a view shows a fault during a quieter step. The cap keeps a call made into a running
	 *  instance from putting the caller's narration into actuality's history. */
	private reportedAt(level: THaibunLogLevel): THaibunLogLevel {
		const ceiling = stepInFlight()?.reportsAt;
		if (ceiling === undefined || HAIBUN_LOG_LEVELS.indexOf(level) >= HAIBUN_LOG_LEVELS.indexOf(UNCAPPED_LEVEL)) return level;
		return HAIBUN_LOG_LEVELS.indexOf(level) > HAIBUN_LOG_LEVELS.indexOf(ceiling) ? ceiling : level;
	}

	/** A step's values with each secret variable's value obscured, by the variable's name. */
	private safeValues(stepValuesMap: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
		return stepValuesMap === undefined ? undefined : sanitizeObjectSecrets(stepValuesMap, this.secrets.isSecret);
	}

	stepStart(featureStep: TFeatureStep, stepperName: string, actionName: string, stepValuesMap: Record<string, unknown> | undefined, isAsync: boolean): void {
		this.emit(
			LifecycleEvent.parse({
				id: formatSeqPath(featureStep.seqPath),
				timestamp: Date.now(),
				kind: "lifecycle",
				type: "step",
				stage: "start",
				in: featureStep.in,
				lineNumber: featureStep.source?.lineNumber,
				featurePath: featureStep.source?.path,
				status: STATUS.running,
				level: stepLevel(featureStep.isSubStep),
				intent: featureStep.intent ? { mode: featureStep.intent.mode } : undefined,
				stepperName,
				actionName,
				stepValuesMap: this.safeValues(stepValuesMap),
				isAsync,
			}),
		);
	}

	stepEnd(
		featureStep: TFeatureStep,
		stepperName: string,
		actionName: string,
		ended: TStepEnd,
		error: string | Error | undefined,
		stepValuesMap: Record<string, unknown> | undefined,
		products: Record<string, unknown> | undefined,
	): void {
		this.emit(
			LifecycleEvent.parse({
				id: formatSeqPath(featureStep.seqPath),
				timestamp: Date.now(),
				kind: "lifecycle",
				type: "step",
				stage: "end",
				in: featureStep.in,
				lineNumber: featureStep.source?.lineNumber,
				featurePath: featureStep.source?.path,
				status: ended,
				level: stepLevel(featureStep.isSubStep),
				// The event leaves out the error field where the step didn't fail, so a view doesn't show an error.
				error: error === undefined ? undefined : errorDetail(error),
				intent: featureStep.intent ? { mode: featureStep.intent.mode } : undefined,
				stepperName,
				actionName,
				stepValuesMap: this.safeValues(stepValuesMap),
				products,
			}),
		);
	}

	/** Emits an artifact event, which the caller parses with its Zod schema, such as ImageArtifact, and identifies. An
	 *  artifact keeps the level it carries. Its step's level doesn't cap it, as it caps a log statement, so a person reading
	 *  actuality's steps sees a screenshot on the step that took it, whatever the level of that step. */
	artifact(artifact: TArtifactEvent): void {
		this.emit(artifact);
	}
}
