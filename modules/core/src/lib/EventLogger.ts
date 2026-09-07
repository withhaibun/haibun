import { errorDetail } from "./util/index.js";
import { BASE_PREFIX, HAIBUN_LOG_LEVELS, LogEvent, LifecycleEvent, NDJSON } from "../schema/protocol.js";
import type { THaibunEvent, TArtifactEvent, THaibunLogLevel, TEventKind } from "../schema/protocol.js";
import { TFeatureStep } from "./astepper.js";
import { sanitizeObjectSecrets } from "./util/secret-utils.js";
import { formatSeqPath } from "./seq-path.js";
import { failFastOrLog } from "./dev-mode.js";

export type TIsSecretFn = (name: string) => boolean;

export type TEventSubscriber = (event: THaibunEvent) => void;

export type TSubscribeOptions = {
	kinds?: readonly TEventKind[];
	/** Delivers only blips whose declared name matches an entry, exactly or as a dotted prefix (`haibun.http` matches
	 *  `haibun.http.request`). Requires `kinds` to include `"blip"`: it filters within the blip audience. */
	names?: readonly string[];
};

/** The run's own story: what the console prints and what a bare subscribe(cb) receives. A blip is not narration; only a
 *  subscriber that names its kind receives it, so a per-frame channel cannot reach the monitor's buffer or SSE by accident. */
const NARRATED_KINDS: ReadonlySet<TEventKind> = new Set<TEventKind>(["lifecycle", "log", "artifact", "control"]);

const matchesName = (names: readonly string[], name: string) => names.some((n) => name === n || name.startsWith(`${n}.`));

export interface IEventLogger {
	suppressConsole?: boolean;
	/** Whether this run was asked for its events as NDJSON, which outranks a monitor's console suppression. */
	readonly ndjsonForced?: boolean;
	currentSeqPath: string | undefined;
	/** How prominently the step now running reports. What is said while it runs reports no more prominently than the
	 *  step does, so a call made into a running instance does not put the caller's own narration into the run's
	 *  history. A warning or a fault is exempt: those report as themselves wherever they happen. */
	stepReportsAt: THaibunLogLevel | undefined;
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
		ok: boolean,
		error: string | Error | undefined,
		stepArgs: Record<string, unknown>,
		stepValuesMap: Record<string, unknown> | undefined,
		products: Record<string, unknown> | undefined,
	): void;
	artifact(featureStep: TFeatureStep, artifact: TArtifactEvent): void;
}

/**
 * Get caller info for the emitter field (e.g., "Executor:238")
 */
function getEmitter(): string {
	const stack = Error().stack?.split("\n");
	if (!stack || stack.length < 5) return "unknown";
	// Find the first non-EventLogger caller
	for (let i = 3; i < Math.min(stack.length, 10); i++) {
		const line = stack[i];
		if (line.includes("EventLogger") || line.includes("emitLog")) continue;
		// Capture function, path, line, col
		// Example: at Executor.doFeatureStep (/home/.../Executor.ts:287:11)
		const match = line.match(/at\s+(?:(\S+)\s+)?\(?(.+?):(\d+):(\d+)\)?$/);
		if (match) {
			const [, func, path, row] = match;
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
	private isSecretFn: TIsSecretFn;
	currentSeqPath: string | undefined;
	stepReportsAt: THaibunLogLevel | undefined;

	/** Set when the run was asked for its events as NDJSON. A caller reading this run's output, rather than a person
	 *  watching it, needs the events whatever else is formatting the console, so this outranks the monitor's
	 *  suppression. */
	public readonly ndjsonForced: boolean;

	constructor(isSecretFn: TIsSecretFn = () => false) {
		this.isSecretFn = isSecretFn;
		this.ndjsonForced = process.env[`${BASE_PREFIX}${NDJSON}`] === "true";
		const isTest = process.env["VITEST"] !== undefined || process.env["NODE_ENV"] === "test";
		this.suppressConsole = !this.ndjsonForced && isTest;
	}

	/** Without options, delivers everything the run narrates and never blips; `{ kinds }` delivers exactly those kinds
	 *  and is the only way to receive `"blip"`; `{ names }` narrows the blips to a declared name or dotted namespace. */
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

	/** One check for a hot path: whether anything at all would receive an event of this kind, and with a blip's declared
	 *  name, whether any subscriber's filter matches it. */
	hasSubscribers(kind: TEventKind, name?: string): boolean {
		if (!this.kindCounts.has(kind)) return false;
		return name === undefined || this.subscribers.some((s) => this.wouldReceive(s, kind, name));
	}

	emit(event: THaibunEvent): void {
		const narrated = NARRATED_KINDS.has(event.kind);
		if (!narrated && !this.kindCounts.has(event.kind)) return;
		const name = event.kind === "blip" ? event.name : undefined;
		const eventWithEmitter = {
			...event,
			emitter: event.emitter || getEmitter(),
		};

		for (const sub of this.subscribers) {
			if (!this.wouldReceive(sub, event.kind, name)) continue;
			const { callback } = sub;
			try {
				callback(eventWithEmitter);
			} catch (e) {
				// Same fan-out isolation as SseSubscriber.dispatch: one broken
				// subscriber must not silence the others. DEV throws so the bug
				// surfaces; PROD logs and continues.
				failFastOrLog("EventLogger subscriber error:", e);
			}
		}
		if (narrated && !this.suppressConsole) {
			console.log(JSON.stringify(eventWithEmitter));
		}
	}

	log(featureStep: TFeatureStep, level: THaibunLogLevel, message: string, attributes?: Record<string, unknown>): void {
		this.emit(
			LogEvent.parse({
				id: formatSeqPath(featureStep.seqPath),
				timestamp: Date.now(),
				kind: "log",
				level: this.reportedAt(level),
				message,
				attributes,
			}),
		);
	}

	// Convenience methods for logging without a featureStep (for cycles, helpers, etc.)
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
		const id = this.currentSeqPath ? `${this.currentSeqPath}.log.${Date.now()}` : `log.${Date.now()}`;
		this.emit(LogEvent.parse({ id, timestamp: Date.now(), kind: "log", level: this.reportedAt(level), message, attributes }));
	}

	/** The level a statement reports at: its own, held to the level of the step it is said during. A warning and a
	 *  fault report as themselves, since a step reporting quietly is not a reason to be quiet about a fault. */
	private reportedAt(level: THaibunLogLevel): THaibunLogLevel {
		const ceiling = this.stepReportsAt;
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
				status: "running",
				level: featureStep.isSubStep ? "trace" : "info",
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
		ok: boolean,
		error: string | Error | undefined,
		_stepArgs: Record<string, unknown>,
		stepValuesMap: Record<string, unknown> | undefined,
		products: Record<string, unknown> | undefined,
	): void {
		// A step that did not fail has no error, and saying so is leaving the field out. Describing `undefined` produces
		// the string "undefined", which reads as an error to anything that shows one.
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
				status: ok ? "completed" : "failed",
				level: featureStep.isSubStep ? "trace" : "info",
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
	 * Emit an artifact event. The artifact should already be a valid TArtifactEvent
	 * (parsed via the appropriate Zod schema like ImageArtifact.parse()).
	 */
	artifact(featureStep: TFeatureStep, artifact: TArtifactEvent): void {
		// Ensure the event has proper id and timestamp
		const event: TArtifactEvent = {
			...artifact,
			id: artifact.id || `${formatSeqPath(featureStep.seqPath)}.artifact`,
			timestamp: artifact.timestamp || Date.now(),
		};
		this.emit(event);
	}
}
