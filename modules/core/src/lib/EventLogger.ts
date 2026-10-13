import { errorDetail } from "./util/index.js";
import { HAIBUN_LOG_LEVELS, LogEvent, LifecycleEvent, STATUS, stepLevel } from "../schema/protocol.js";
import type { THaibunEvent, TArtifactEvent, THaibunLogLevel, TEventKind, TStepEnd } from "../schema/protocol.js";
import { TFeatureStep } from "./astepper.js";
import { sanitizeObjectSecrets } from "./util/secret-utils.js";
import { formatSeqPath } from "./seq-path.js";
import { failFastOrLog } from "./dev-mode.js";
import { stepInFlight, writeBound } from "./capability-context.js";
import { writtenAt } from "./actions.js";
import { Access } from "./resources.js";

type TIsSecretFn = (name: string) => boolean;

type TEventSubscriber = (event: THaibunEvent) => void;

type TSubscribeOptions = {
	kinds?: readonly TEventKind[];
	/** Delivers only blips whose declared name matches an entry, in full or as a dotted prefix (`haibun.http` matches
	 *  `haibun.http.request`). Requires `kinds` to include `"blip"`, because it filters blips only. */
	names?: readonly string[];
};

/** The narrated kinds. The console prints them, and a subscribe(cb) without options receives them. A blip isn't
 *  narrated. Only a subscriber that lists the blip kind receives a blip, so the monitor's buffer and SSE receive
 *  per-frame blips only where they list that kind. */
const NARRATED_KINDS: ReadonlySet<TEventKind> = new Set<TEventKind>(["lifecycle", "log", "artifact", "control"]);

/** The level an event is written at where it doesn't state one and a ceiling doesn't bound the call that emits it. An
 *  event of actuality holds its steps, logs and records, so it is private. */
const EVENT_LEVEL = Access.private;

const matchesName = (names: readonly string[], name: string) => names.some((n) => name === n || name.startsWith(`${n}.`));

export interface IEventLogger {
	suppressConsole?: boolean;
	/** Whether NDJSON output of events was requested. It takes precedence over a monitor's console suppression. */
	readonly ndjsonForced?: boolean;
	subscribe(callback: TEventSubscriber, options?: TSubscribeOptions): void;
	unsubscribe(callback: TEventSubscriber): void;
	hasSubscribers(kind: TEventKind, name?: string): boolean;
	emit(event: THaibunEvent): void;
	log(featureStep: TFeatureStep, level: THaibunLogLevel, message: string, attributes?: Record<string, unknown>): void;
	// Convenience methods for logging without a featureStep
	info(message: string, attributes?: Record<string, unknown>): void;
	debug(message: string, attributes?: Record<string, unknown>): void;
	warn(message: string, attributes?: Record<string, unknown>): void;
	error(message: string, attributes?: Record<string, unknown>): void;
	stepStart(
		featureStep: TFeatureStep,
		stepperName: string,
		actionName: string,
		stepArgs: Record<string, unknown>,
		stepValuesMap: Record<string, unknown> | undefined,
		isAsync?: boolean,
	): void;
	stepEnd(
		featureStep: TFeatureStep,
		stepperName: string,
		actionName: string,
		ended: TStepEnd,
		error: string | Error | undefined,
		stepArgs: Record<string, unknown>,
		stepValuesMap: Record<string, unknown> | undefined,
		products: Record<string, unknown> | undefined,
	): void;
	artifact(featureStep: TFeatureStep, artifact: TArtifactEvent): void;
}

/**
 * Returns the caller's file, function and line for the emitter field, such as "Executor.doFeatureStep:287".
 */
function getEmitter(): string {
	const stack = Error().stack?.split("\n");
	if (!stack || stack.length < 5) return "unknown";
	// Find the first non-EventLogger caller
	for (const line of stack.slice(3, 10)) {
		if (line.includes("EventLogger") || line.includes("emitLog")) continue;
		// Capture function, path, line, col
		// Example: at Executor.doFeatureStep (/home/.../Executor.ts:287:11)
		const match = line.match(/at\s+(?:(\S+)\s+)?\(?(.+?):(\d+):(\d+)\)?$/);
		if (match) {
			const [, func, path = "", row] = match;
			const shortFunc = func ? func.split(".").pop() : "at";
			const file = path
				.split("/")
				.pop()
				?.replace(/\.[^/.]+$/, "");
			return `${file}.${shortFunc}:${row}`;
		}
	}
	return "unknown";
}

export class EventLogger implements IEventLogger {
	private subscribers: { callback: TEventSubscriber; kinds?: ReadonlySet<TEventKind>; names?: readonly string[] }[] = [];
	private kindCounts = new Map<TEventKind, number>();
	public suppressConsole: boolean = false;

	/** `ndjsonForced` is true when NDJSON output of events was requested. A process reads that output, and it requires
	 *  every event while a monitor formats the console. So ndjsonForced takes precedence over the monitor's console
	 *  suppression. */
	constructor(
		private isSecretFn: TIsSecretFn = () => false,
		public readonly ndjsonForced = false,
	) {}

	/** Without options, delivers every narrated kind and never a blip. `{ kinds }` delivers those kinds only, and is the
	 *  only way to receive `"blip"`. `{ names }` narrows the blips to a declared name or dotted namespace. */
	subscribe(callback: TEventSubscriber, options?: TSubscribeOptions): void {
		if (options?.names && !options.kinds?.includes("blip")) throw new Error(`subscribe: names filters blips; include kinds: ["blip"]`);
		const kinds = options?.kinds ? new Set(options.kinds) : undefined;
		this.subscribers.push({ callback, kinds, names: options?.names });
		for (const kind of kinds ?? NARRATED_KINDS) this.kindCounts.set(kind, (this.kindCounts.get(kind) ?? 0) + 1);
	}

	unsubscribe(callback: TEventSubscriber): void {
		for (const held of this.subscribers.filter((s) => s.callback === callback))
			for (const kind of held.kinds ?? NARRATED_KINDS) {
				const count = (this.kindCounts.get(kind) ?? 0) - 1;
				if (count > 0) this.kindCounts.set(kind, count);
				else this.kindCounts.delete(kind);
			}
		this.subscribers = this.subscribers.filter((s) => s.callback !== callback);
	}

	private wouldReceive(sub: { kinds?: ReadonlySet<TEventKind>; names?: readonly string[] }, kind: TEventKind, name?: string): boolean {
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
		// write action.
		const eventWithEmitter = { ...event, emitter: event.emitter || getEmitter(), accessLevel: writtenAt(event.accessLevel, EVENT_LEVEL, writeBound()) };

		for (const sub of this.subscribers) {
			if (!this.wouldReceive(sub, event.kind, name)) continue;
			const { callback } = sub;
			try {
				callback(eventWithEmitter);
			} catch (e) {
				// failFastOrLog logs a subscriber's error in PROD, so delivery to the other subscribers continues, as in
				// StreamListeners.dispatch. In DEV it re-throws the error.
				failFastOrLog("EventLogger subscriber error:", e);
			}
		}
		if (narrated && !this.suppressConsole) {
			console.log(JSON.stringify(eventWithEmitter));
		}
	}

	log(featureStep: TFeatureStep, level: THaibunLogLevel, message: string, attributes?: Record<string, unknown>): void {
		this.emit(LogEvent.parse({ id: formatSeqPath(featureStep.seqPath), timestamp: Date.now(), kind: "log", level: this.reportedAt(level), message, attributes }));
	}

	// Convenience methods for logging without a featureStep, such as from cycles and helpers.
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

	private emitLog(level: THaibunLogLevel, message: string, attributes?: Record<string, unknown>): void {
		const seqPath = stepInFlight()?.seqPath;
		const id = seqPath ? `${seqPath}.log.${Date.now()}` : `log.${Date.now()}`;
		this.emit(LogEvent.parse({ id, timestamp: Date.now(), kind: "log", level: this.reportedAt(level), message, attributes }));
	}

	/** Returns the level of a log statement: its own level, capped at the level of the step in flight. A warning or an
	 *  error keeps its own level, so a view shows a fault during a quieter step. The cap keeps a call made into a running
	 *  instance from putting the caller's narration into actuality's history. */
	private reportedAt(level: THaibunLogLevel): THaibunLogLevel {
		const ceiling = stepInFlight()?.reportsAt;
		if (ceiling === undefined || HAIBUN_LOG_LEVELS.indexOf(level) >= HAIBUN_LOG_LEVELS.indexOf("warn")) return level;
		return HAIBUN_LOG_LEVELS.indexOf(level) > HAIBUN_LOG_LEVELS.indexOf(ceiling) ? ceiling : level;
	}

	stepStart(
		featureStep: TFeatureStep,
		stepperName: string,
		actionName: string,
		stepArgs: Record<string, unknown>,
		stepValuesMap: Record<string, unknown> | undefined,
		isAsync?: boolean,
	): void {
		const safeStepValuesMap = stepValuesMap ? sanitizeObjectSecrets(stepValuesMap, this.isSecretFn) : undefined;
		const safeStepArgs = sanitizeObjectSecrets(stepArgs, () => false);
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
				stepArgs: safeStepArgs,
				stepValuesMap: safeStepValuesMap,
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
		_stepArgs: Record<string, unknown>,
		stepValuesMap: Record<string, unknown> | undefined,
		products: Record<string, unknown> | undefined,
	): void {
		// The event leaves out the error field where error is undefined. errorDetail(undefined) returns the string
		// "undefined", which a view would show as an error.
		const errorMessage = error === undefined ? undefined : errorDetail(error);
		const safeStepValuesMap = stepValuesMap ? sanitizeObjectSecrets(stepValuesMap, this.isSecretFn) : undefined;
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
				error: errorMessage,
				intent: featureStep.intent ? { mode: featureStep.intent.mode } : undefined,
				stepperName,
				actionName,
				stepValuesMap: safeStepValuesMap,
				products,
			}),
		);
	}

	/**
	 * Emits an artifact event. The caller parses the TArtifactEvent with its Zod schema, such as ImageArtifact, before it
	 * passes the event.
	 */
	artifact(featureStep: TFeatureStep, artifact: TArtifactEvent): void {
		// An artifact keeps the level it carries, which its schema sets to info by default. Its step's level doesn't cap it,
		// as it caps a log statement. A view shows an artifact on the row of the step that produced it, so a person reading
		// actuality's steps sees a screenshot on the step that took it, whatever the level of that step.
		const event: TArtifactEvent = { ...artifact, id: artifact.id || `${formatSeqPath(featureStep.seqPath)}.artifact`, timestamp: artifact.timestamp || Date.now() };
		this.emit(event);
	}
}
