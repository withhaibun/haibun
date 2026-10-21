import { z } from "zod";
import { AccessLevelSchema } from "./resources.js";
import type { TRemedy } from "../transport/domains/rpc-wire.js";
import type { TActuality } from "../actuality/machines/actuality.js";

// ============================================================================
// Constants
// ============================================================================

export const HAIBUN_LOG_LEVELS = ["debug", "trace", "log", "info", "warn", "error"] as const;
const HaibunLogLevel = z.enum(HAIBUN_LOG_LEVELS);
export type THaibunLogLevel = z.infer<typeof HaibunLogLevel>;
/** The values of the `LOG_LEVEL` option. They are the event levels and `none`. A monitor set to `none` doesn't show an event. */
export const SHOWN_LOG_LEVELS = [...HAIBUN_LOG_LEVELS, "none"] as const;
/** The schema of actuality's `LOG_LEVEL` option. BaseOptionsSchema validates the option with it. */
export const ShownLogLevelSchema = z.enum(SHOWN_LOG_LEVELS);
export type TShownLogLevel = z.infer<typeof ShownLogLevelSchema>;
/** Returns actuality's `LOG_LEVEL` option, or `info` where the option isn't set. A monitor shows each event at or above this level. */
export const shownLogLevel = (options: { LOG_LEVEL?: TShownLogLevel }): TShownLogLevel => options.LOG_LEVEL ?? "info";

/**
 * The marks form one related set. A mark varies in two visual properties, and each property carries one kind of information.
 *
 * WEIGHT indicates how much a line should interrupt a reader. Emoji-weight marks indicate an outcome, a warning or an
 * error. A reader must not miss these lines. Thin glyphs indicate frequent, unremarkable lines. A log of ordinary
 * activity then shows thin glyphs, and an exceptional line is visible among them. Under this rule an exceptional line
 * doesn't carry a thin glyph.
 *
 * SHAPE indicates what a mark reports: a verdict, a tried claim, a returned call or structure. Actuality's verdicts are
 * the check and the cross. A claim actuality tried carries the modal-logic diamond. The diamond indicates possibility,
 * not a pass or a failure. It is filled where the claim held and hollow where the claim didn't hold. A failed call that
 * actuality handed out carries the return arrow. The call failed, but actuality isn't broken. Actuality returns the
 * failure to the call's caller. The caller handles the failure. Container and flow marks are geometric because they
 * indicate structure, not an outcome.
 */

// Verdicts: the outcome actuality determined. A verdict has emoji weight because a reader looks for it.
export const CHECK_YES = "✅";
export const CHECK_NO = "❌";
export const CHECK_YIELD = "🔀";

// A nested call's failure is part of its line's proof, and the line's own verdict states whether the proof holds, so its
// mark isn't a verdict mark. It carries less weight than a verdict.
export const MAYBE_CHECK_NO = "◇";

// Handed-out calls: a negative seqPath segment marks a call actuality handed out, such as a model's tool call or an RPC.
// Actuality returns the call's failure to its caller. That failure isn't actuality failing, so its mark isn't a verdict,
// and the line still shows a mark.
export const RETURNED_TO_CALLER = "↩️";

// BDD Structure (Geometric Containers)
export const ICON_FEATURE = "⧇"; // Root container (High visibility)
export const ICON_SCENARIO = "⬢"; // Concrete logic node (Solid Hex)

// Step execution status uses the verdict marks. A running step carries a flow mark, and a stopped step carries a square.
export const ICON_STEP_RUNNING = "⫸"; // Active flow (Clear direction)
export const ICON_STEP_FAILED = CHECK_NO;
export const ICON_STEP_STOPPED = "◼";

/** Returns whether a lifecycle event is of a call nested in a line's proof. A nested call that fails doesn't fail its line:
 *  its line's own record states whether the proof holds, so a nested failure reads apart from a line's failure. */
export function isNestedEvent(event: { level?: string }): boolean {
	return event.level === SUBSTEP_LEVEL;
}

/** Returns whether the event's id has a negative seqPath segment. A negative segment marks a call actuality handed out,
 *  such as a model's tool call or an RPC. Actuality returns the call's failure to its caller. The caller handles the
 *  failure, so the failure isn't actuality failing. */
export function isHandedOutEvent(event: { id?: string }): boolean {
	return String(event.id ?? "")
		.split(".")
		.some((n) => Number.parseInt(n, 10) < 0);
}
/** Whether a step's failure is the feature's own. A nested call's failure is part of its line's proof, and its line's record
 *  states whether the proof holds. A synthetic dispatch has a negative seqPath index, and its failure is the failure of the
 *  step that dispatched it. */
export const ownFailure = (step: { isSubStep?: boolean; seqPath?: readonly number[] }): boolean => step.isSubStep !== true && !step.seqPath?.some((n) => n < 0);
export const ICON_STEP_COMPLETED = CHECK_YES;

// Log levels: info lines are frequent, so the info mark is a thin glyph. Warning and error lines are exceptional, so their
// marks have emoji weight. The error mark differs from the failure verdict, so an error log line doesn't show a second
// failure verdict.
export const ICON_LOG_INFO = "⊳"; // Data signal/pointer
export const ICON_LOG_WARN = "⚠️";
export const ICON_LOG_ERROR = "⛔";

export const ICON_DEFAULT = "•";

// Structured Output
export const ICON_ARTIFACT = "⌬"; // Benzene ring
export enum Origin {
	defined = "defined",
	var = "var",
	env = "env",
	quoted = "quoted",
}
export type TOrigin = keyof typeof Origin;

export type TDebugSignal = "fail" | "step" | "continue" | "retry" | "next";

/** The level of a substep's record and lifecycle events. EventLogger also caps a substep's log statements at this level,
 *  except a warning or an error. The level is below each view's default level, so a view doesn't show a substep's record,
 *  events, products or capped logs until a reader selects this level or a lower one. That output is infrastructure, not
 *  something a reader requested. */
export const SUBSTEP_LEVEL: THaibunLogLevel = "trace";
/** The level of an ordinary step's record and lifecycle events. */
const STEP_LEVEL: THaibunLogLevel = "info";

/** Returns the level of a step's record and lifecycle events. The step's end event carries its products, so the products
 *  have the same level. */
export const stepLevel = (isSubStep?: boolean): THaibunLogLevel => (isSubStep ? SUBSTEP_LEVEL : STEP_LEVEL);

/** The levels of an execution, outermost first. A lifecycle event of a level is a move of the actuality machine, and the
 *  record of each level states its level. */
export const ACTUALITY_LEVELS = ["execution", "feature", "scenario", "step"] as const;
export type TActualityLevel = (typeof ACTUALITY_LEVELS)[number];

export const SCENARIO_START = "scenario";
/** The heading of a scenario that states a requirement the steppers don't provide yet. Its lines don't resolve or run. */
export const PENDING_SCENARIO = "pendingScenario";
export const FEATURE_START = "feature";
/** The actions of the headings: a feature's, a scenario's and a pending scenario's. */
export const HEADINGS: readonly string[] = [FEATURE_START, SCENARIO_START, PENDING_SCENARIO];

/** The prefixes that declare a feature and a scenario in a feature's text. `declaredName` returns the name after a prefix. */
export const DECLARES = { feature: "Feature:", scenario: "Scenario:" } as const;

/** Returns whether a step declared a feature or a scenario. Each function checks the name of the action the step called, so
 *  a `feature` or `scenario` action of any stepper counts. */
export const declaresFeature = (called: string | undefined): boolean => called?.endsWith(`.${FEATURE_START}`) === true;
export const declaresScenario = (called: string | undefined): boolean => called?.endsWith(`.${SCENARIO_START}`) === true;

/** Returns the name in a declaring step's text. The name is the trimmed text without its declaring prefix. */
export const declaredName = (text: string, of: keyof typeof DECLARES): string => text.replace(new RegExp(`^${DECLARES[of]}\\s*`), "").trim();

/** The status words, stated once. `pending` marks work that hasn't started, `running` work in progress, and `completed`,
 *  `failed` and `stopped` how it ended. `stopped` marks work whose caller aborted it; a stop isn't a fault, so it doesn't count
 *  as a failure or a pass. `skipped` marks a step that isn't run. Every other status set is a subset of these words or a
 *  mapping of them. */
export const STATUS = { pending: "pending", running: "running", completed: "completed", failed: "failed", stopped: "stopped", skipped: "skipped" } as const;
export type TStatus = (typeof STATUS)[keyof typeof STATUS];
/** The statuses of a lifecycle event: every word but `pending`, since an event marks a lifecycle that started. */
const LIFECYCLE_STATUS_SCHEMA = z.enum([STATUS.running, STATUS.completed, STATUS.failed, STATUS.stopped, STATUS.skipped]);
/** How a step ended. */
export type TStepEnd = typeof STATUS.completed | typeof STATUS.failed | typeof STATUS.stopped;
/** The word a persisted record or file stores for each status it holds: a step's SeqPath record, a test run's record and
 *  the run-once file. Each has stored `passed` for `completed` since it began, and stores, pages, features and files read
 *  that word, so a record keeps it; the other words are the vocabulary's own. */
export const RECORDED_STATUS = { running: STATUS.running, completed: "passed", failed: STATUS.failed, stopped: STATUS.stopped } as const satisfies Partial<Record<TStatus, string>>;
export type TRecordedStatus = (typeof RECORDED_STATUS)[keyof typeof RECORDED_STATUS];

export const STAY_ALWAYS = "always";
export const STAY_FAILURE = "failure";
export const STAY = "STAY";
/** The option that selects actuality's events as NDJSON on stdout. The option, the environment variable a launcher writes
 *  and the logger that reads the option all use this one constant. */
export const NDJSON = "NDJSON";
/** With this option the CLI runs a group only when a dependency changed since the group last passed. It applies to the
 *  chain a script runs, so a run that another run starts doesn't inherit it. */
export const ONCE = "ONCE";

export const STEP_DELAY = "STEP_DELAY";
export const DEFAULT_DEST = "default";
export const TEST_BASE = "test_base";
export const CONTINUE_AFTER_ERROR = "CONTINUE_AFTER_ERROR";

export const HAIBUN = "HAIBUN";
export const BASE_PREFIX = `${HAIBUN}_`;
/** The prefix of a stepper's option in the environment and in a base's config. The stepper's name and the option's name follow it. */
export const MODULE_OPTION_PREFIX = `${BASE_PREFIX}O_`;
export const CAPTURE = "capture";

// ============================================================================
// Utilities
// ============================================================================

export class Timer {
	static startTime = new Date();
	static key = `${Timer.startTime.getTime()}`;
	static START_TIME = Date.now();

	static since() {
		return Date.now() - Timer.START_TIME;
	}
}

export function shortenURI(uri: string): string {
	try {
		const url = new URL(uri);
		return url.pathname.split("/").pop() || uri;
	} catch {
		return uri;
	}
}

// ============================================================================
// Formatting
// ============================================================================

/** The indication of a nested call's failure, which its line's proof reads. */
export const NESTED_FAILURE = `nested-${STATUS.failed}` as const;
/** A lifecycle event's indication: its status, read with its level where it failed. A nested call's failure is part of its
 *  line's proof, so it reads apart from a line's failure. */
export type TIndication = z.infer<typeof LIFECYCLE_STATUS_SCHEMA> | typeof NESTED_FAILURE;

export class EventFormatter {
	static shouldDisplay(event: THaibunEvent, minLevel: TShownLogLevel): boolean {
		const minLevelIndex = SHOWN_LOG_LEVELS.indexOf(minLevel);
		const eventLevelIndex = HAIBUN_LOG_LEVELS.indexOf(event.level);

		if (eventLevelIndex < minLevelIndex) {
			return false;
		}

		if (event.kind === "lifecycle") {
			if (event.type === "step") return event.stage === "end";
			if (event.type === "feature" || event.type === "scenario") return event.stage === "start";
			return false;
		}
		if (event.kind === "log") {
			return true;
		}
		return false;
	}

	static getDisplayLevel(event: THaibunEvent): string {
		if (event.kind === "lifecycle") {
			return "info";
		}
		if (event.kind === "log") {
			return event.level;
		}
		return "info";
	}

	static getStatusIcon(event: THaibunEvent & { kind: "lifecycle" }): string {
		if (event.status === STATUS.completed) return ICON_STEP_COMPLETED;
		if (event.status === STATUS.failed) return isNestedEvent(event) ? ` ${MAYBE_CHECK_NO}` : isHandedOutEvent(event) ? RETURNED_TO_CALLER : ICON_STEP_FAILED;
		if (event.status === STATUS.running) return ICON_STEP_RUNNING;
		if (event.status === STATUS.stopped) return ICON_STEP_STOPPED;
		return ` ${ICON_DEFAULT}`;
	}

	/** Returns a lifecycle event's indication, or undefined where the event doesn't state a status. */
	static getIndication(event: THaibunEvent & { kind: "lifecycle" }): TIndication | undefined {
		return event.status === STATUS.failed && isNestedEvent(event) ? NESTED_FAILURE : event.status;
	}

	static formatLineElements(event: THaibunEvent, lastLevel?: string) {
		const time = (Timer.since() / 1000).toFixed(3);
		const emitter = event.emitter || event.source;
		const level = this.getDisplayLevel(event);
		const showLevel = lastLevel === level ? level.charAt(0) : level;

		let icon = "";
		let id = "";
		let message = "";

		if (event.kind === "lifecycle") {
			if (event.type === "feature") {
				icon = ICON_FEATURE;
				message = event.featurePath;
			} else if (event.type === "scenario") {
				icon = ICON_SCENARIO;
				message = event.scenarioName;
			} else {
				icon = this.getStatusIcon(event);
				id = event.id ? `${event.id}` : "";
				// A step event always has `in`. Other lifecycle events, such as activity, may not have it.
				if (event.type === "step") {
					message = event.in;
				} else {
					// Other lifecycle events (activity, ensure, etc)
					if (event.in) {
						message = event.in;
					}
				}

				if (event.error) message += ` (${event.error})`;
			}
		} else if (event.kind === "log") {
			const levelIcons: Record<string, string> = { info: ICON_LOG_INFO, warn: ICON_LOG_WARN, error: ICON_LOG_ERROR };
			icon = levelIcons[event.level] || ICON_DEFAULT;
			id = event.id ? `${event.id}` : "";
			message = event.message;
		}
		return { time, emitter, level, showLevel, icon, id, message };
	}

	static formatLine(event: THaibunEvent, lastLevel?: string): string {
		const { time, emitter, showLevel, icon, id, message } = this.formatLineElements(event, lastLevel);
		const prefix = showLevel.padStart(8) + ` █ ${time}:${emitter}`.padEnd(40) + ` ｜ `;
		// The brackets around a step's path are display formatting only. An id has one form wherever it is stored or matched.
		return prefix + `${icon} ${id ? `[${id}] ` : ""}${message}`;
	}
}

// ============================================================================
// Execution Protocol
// ============================================================================

/** Execution trace field on products. */
export const TRACE_SEQ_PATH = "_seqPath";

/** Hypermedia product field keys. Use these constants instead of string literals. */
export const HYPERMEDIA = {
	/** The domain label of the result, such as a persisted type's name. */
	TYPE: "_type",
	/** Human-readable one-liner for CLI output and document view captions */
	SUMMARY: "_summary",
	/** The `description` of the producing step's products domain. The product carries it, so a person, an LLM or an agent reads the product's description without calling `show steps matching`. Unset where the products domain doesn't have a description. */
	DESCRIPTION: "_description",
	/** Web component tag that renders this product (e.g. "shu-monitor-column") */
	COMPONENT: "_component",
	/** HATEOAS affordances: what can be done next, keyed by rel */
	LINKS: "_links",
	/** For destructive operations: condition to check reversibility, apply to execute undo */
	UNDO: "_undo",
} as const;

/** Returns a product's own data. The result omits the `_seqPath` trace and the `_type`, `_summary`, `_description` and
 *  `_links` markers that dispatch adds to a product of a named domain. A reader parses the result with the product's own
 *  schema. */
export function productData(products: Record<string, unknown>): Record<string, unknown> {
	const {
		[TRACE_SEQ_PATH]: _trace,
		[HYPERMEDIA.TYPE]: _type,
		[HYPERMEDIA.SUMMARY]: _summary,
		[HYPERMEDIA.DESCRIPTION]: _description,
		[HYPERMEDIA.LINKS]: _links,
		...data
	} = products;
	return data;
}

export type THypermediaProducts = {
	[TRACE_SEQ_PATH]?: TSeqPath;
	[HYPERMEDIA.TYPE]?: string;
	[HYPERMEDIA.SUMMARY]?: string;
	[HYPERMEDIA.DESCRIPTION]?: string;
	[HYPERMEDIA.COMPONENT]?: string;
	[HYPERMEDIA.LINKS]?: Record<string, { method: string; params?: Record<string, unknown>; schema?: Record<string, unknown> }>;
	[HYPERMEDIA.UNDO]?: { condition: string; apply: string };
	[key: string]: unknown;
};

/**
 * How the logic engine ended a goal, with its EARL outcome where EARL states one: proved (earl:passed), refuted by what a
 * step returned or a stated falsity (earl:failed), unknown where a step doesn't prove or refute it (earl:cantTell), and a
 * contradiction where it is both proved and refuted.
 */
export const VERDICT = { proved: "proved", refuted: "refuted", unknown: "unknown", contradiction: "contradiction" } as const;
export type TVerdict = (typeof VERDICT)[keyof typeof VERDICT];

/** The stepper a configuration lists to supply the logic engine that proves every step. */
export const LOGIC_STEPPER = "@haibun/logic/logic-stepper";
/** The class name of the stepper `LOGIC_STEPPER` names. */
export const LOGIC_STEPPER_NAME = "LogicStepper";

/**
 * The one result type of step execution. Step actions, the logic engine's proofs, the feature loop and RPC transports use
 * it. A proof's result states the verdict of its goal.
 */
type TActionResultCarries = { products?: THypermediaProducts; controlSignal?: TDebugSignal; artifact?: TArtifactEvent; verdict?: TVerdict };
/** A step passed or failed. A failure carries an `errorMessage` that states the reason, and the remedy a caller can act
 *  on where one exists, as data a page renders as a control. */
export type TActionResult = (TActionResultCarries & { ok: true; errorMessage?: undefined }) | (TActionResultCarries & { ok: false; errorMessage: string; remedy?: TRemedy });

export const OK: TActionResult = { ok: true };

/** A result's verdict: the verdict it states, or proved where it passed and refuted where it failed. */
export const verdictOf = (result: TActionResult): TVerdict => (result.verdict === undefined ? (result.ok ? VERDICT.proved : VERDICT.refuted) : result.verdict);

export type TStepValueValue = unknown;
export type TStepArgs = Record<string, TStepValueValue>;

export type TStepValue = { term: string; domain: string; value?: TStepValueValue; origin: TOrigin; readonly?: boolean; secret?: boolean };

export type TProvenanceIdentifier = { in?: string; seq: number[]; when: string };

// Result Types

export type TSeqPath = number[];

/**
 * Step result with execution trace metadata.
 * Extends TActionResult with context about where/when the step ran.
 */
export type TStepResult = TActionResult & {
	name: string;
	in: string;
	/** The feature file that contains the step's line. A step called over RPC or MCP doesn't have one. */
	path?: string;
	lineNumber?: number;
	seqPath: TSeqPath;
	/** True for a call nested in a line's proof. */
	isSubStep?: boolean;
	start?: number;
	end?: number;
};

/**
 * A summary of a feature's steps, computed as a reduction over them instead of a list of them.
 *
 * A feature that services requests for weeks runs more steps than a process can hold. A reader of the result reads the
 * count, the first start, the last end and the failed step. Actuality updates each value as the feature runs, so the
 * summary takes the same memory for ten steps or ten million.
 */
export type TFeatureSteps = {
	/** The number of steps the feature ran. */
	count: number;
	/** When the first step began and when the last step ended. */
	firstStart?: number;
	lastEnd?: number;
	/**
	 * The step that actuality reports as failed. A negative seqPath segment marks a synthetic dispatch, such as a model's
	 * tool call or an RPC. A synthetic dispatch can fail, and the step that made it can recover. A nested call's failure
	 * is part of its line's proof. Actuality therefore reports the feature's own failed line ahead of either. Where every
	 * failure is a synthetic dispatch or a nested call, actuality reports the first failure.
	 */
	failed?: TStepResult;
};

export type TFeatureResult = {
	path: string;
	ok: boolean;
	/** The summary of its steps. */
	steps: TFeatureSteps;
	/** The full results of the most recent steps the feature ran, up to RESULTS_READ_IN_FULL. `steps` summarizes every step. */
	stepResults: TStepResult[];
	/** The name of each pending scenario the feature states, in order. */
	pending: string[];
};

export type TExecutorResult = {
	ok: boolean;
	/** The execution's levels as the actuality machine holds them once the execution ended, or as they stood where a phase
	 *  before the execution failed. */
	actuality: TActuality;
	tag: unknown;
	shared: unknown;
	featureResults: TFeatureResult[];
	failure?: { stage: string; error: { details: Record<string, unknown>; message: string } };
	steppers?: unknown[];
};

// ============================================================================
// Prompt Types
// ============================================================================

export const Prompt = z.object({ id: z.string(), message: z.string(), context: z.unknown().optional(), options: z.array(z.string()).optional() });
export type TPrompt = z.infer<typeof Prompt>;

// ============================================================================
// Event Schema
// ============================================================================

const BaseEvent = z.object({
	id: z.string().describe("Unique identifier for the event, typically the seqPath"),
	timestamp: z.number().int().describe("Absolute epoch timestamp in milliseconds"),
	source: z.string().default("haibun").describe("Source of the event"),
	emitter: z.string().optional().describe("Code location that emitted the event (e.g. Executor:238)"),
	level: HaibunLogLevel.default("info").describe("Log level for filtering"),
	accessLevel: AccessLevelSchema.optional().describe(
		"The access level of what the event may reveal. An event that doesn't state one takes the read level of the call that emitted it. Actuality sends the event only to a follower that may read at this level.",
	),
});

/** The level an event reports at, as the protocol reads it from any event. */
export const EventLevelSchema = BaseEvent.pick({ level: true });

// Lifecycle Events
const LifecycleEventCommon = BaseEvent.extend({
	kind: z.literal("lifecycle"),
	stage: z.enum(["start", "end"]),

	// Execution Context
	status: LIFECYCLE_STATUS_SCHEMA.optional(),
	error: z.string().optional(),
});

// Specific Events
const FeatureEvent = LifecycleEventCommon.extend({
	type: z.literal("feature"),
	featurePath: z.string().describe("Feature file path"),
	featureName: z.string().describe("Feature display name"),
});

const ScenarioEvent = LifecycleEventCommon.extend({ type: z.literal("scenario"), scenarioName: z.string().describe("Scenario name"), featurePath: z.string().optional() });

const StepEvent = LifecycleEventCommon.extend({
	type: z.literal("step"),
	in: z.string().describe("The step's line"),
	lineNumber: z.number().optional(),
	stepperName: z.string().optional(),
	actionName: z.string().optional(),
	stepValuesMap: z.record(z.string(), z.unknown()).optional(),
	products: z.record(z.string(), z.unknown()).optional(),
	isAsync: z.boolean().optional(),
	featurePath: z.string().optional(),
});

// The execution's events
const GenericLifecycleEvent = LifecycleEventCommon.extend({
	type: z.literal("execution"),
	in: z.string().optional(),
	products: z.record(z.string(), z.unknown()).optional(),
	lineNumber: z.number().optional(),
	featurePath: z.string().optional(),
});

export const LifecycleEvent = z.union([FeatureEvent, ScenarioEvent, StepEvent, GenericLifecycleEvent]);

// Log Events
/** The attributes of a log event that reports a failure outside a step's own result, such as a background task's tick: the
 *  event it reports and the step of that event. A reader of actuality's log reads a failure by these keys. Dotted keys are
 *  OpenTelemetry's convention, so an exporter carries them without a translation. */
export const EVENT_ATTRIBUTE = { event: "haibun.event", seqPath: "haibun.seqPath" } as const;
/** The value of the event attribute of a log event that reports a step's failure. */
export const STEP_FAILURE_EVENT = "step.failure";

export const LogEvent = BaseEvent.extend({
	kind: z.literal("log"),
	level: HaibunLogLevel,
	message: z.string(),
	attributes: z.record(z.string(), z.unknown()).optional(), // Structured log data
});

// Artifact Events - Base
const BaseArtifact = BaseEvent.extend({
	kind: z.literal("artifact"),
	/** The level of the artifact event. A view shows an artifact on the row of the step that produced it, whatever that
	 *  step's level. This level doesn't determine whether a reader sees the artifact. */
	level: HaibunLogLevel.default("info"),
	// Path relative to the feature dir (e.g. "./image/x.png"). That dir contains the serialized report's shu.html, so the
	// report references artifacts by this relative path. `path` holds the base-relative form for the live /artifacts route.
	featureRelativePath: z.string().optional(),
});

// Artifact Subtypes
export const ImageArtifact = BaseArtifact.extend({ artifactType: z.literal("image"), path: z.string(), mimetype: z.string().default("image/png") });

export const VideoArtifact = BaseArtifact.extend({
	artifactType: z.literal("video"),
	path: z.string(),
	mimetype: z.string().default("video/webm"),
	isTimeLined: z.boolean().default(true),
	startTime: z.number().optional().describe("Epoch timestamp when video recording started"),
	duration: z.number().optional(),
});

export const VideoStartArtifact = BaseArtifact.extend({ artifactType: z.literal("video-start"), startTime: z.number().describe("Relative start time of video in milliseconds") });

export const HtmlArtifact = BaseArtifact.extend({ artifactType: z.literal("html"), path: z.string(), mimetype: z.string().default("text/html") });

export const SpeechArtifact = BaseArtifact.extend({
	artifactType: z.literal("speech"),
	path: z.string(),
	mimetype: z.string().default("audio/mpeg"),
	transcript: z.string().optional(),
	durationS: z.number().optional(),
});

export const JsonArtifact = BaseArtifact.extend({ artifactType: z.literal("json"), json: z.record(z.string(), z.unknown()), mimetype: z.string().default("application/json") });

const MermaidArtifact = BaseArtifact.extend({ artifactType: z.literal("mermaid"), source: z.string(), mimetype: z.string().default("text/x-mermaid") });

export const HttpTraceArtifact = BaseArtifact.extend({
	artifactType: z.literal("http-trace"),
	httpEvent: z.enum(["request", "response"]),
	trace: z.object({
		frameURL: z.string().optional(),
		requestingPage: z.string().optional(),
		requestingURL: z.string().optional(),
		method: z.string().optional(),
		headers: z.record(z.string(), z.string()).optional(),
		postData: z.unknown().optional(),
		status: z.number().optional(),
		statusText: z.string().optional(),
	}),
	mimetype: z.string().default("application/json"),
});

export const ResolvedFeaturesArtifact = BaseArtifact.extend({
	artifactType: z.literal("resolvedFeatures"),
	resolvedFeatures: z.array(z.unknown()),
	index: z.number().optional(),
	mimetype: z.string().default("application/json"),
});

// Generic file artifact for other types
const FileArtifact = BaseArtifact.extend({ artifactType: z.literal("file"), path: z.string(), mimetype: z.string() });

export const ArtifactEvent = z.discriminatedUnion("artifactType", [
	ImageArtifact,
	VideoArtifact,
	VideoStartArtifact,
	HtmlArtifact,
	SpeechArtifact,
	JsonArtifact,
	MermaidArtifact,
	HttpTraceArtifact,
	ResolvedFeaturesArtifact,
	FileArtifact,
]);

/** The signal actuality sends when the steps its registry holds change. A page that read the steps reads them again. */
export const STEPS_CHANGED = "steps-changed";

// Control Events
export const ControlEvent = BaseEvent.extend({
	kind: z.literal("control"),
	// Debugger signals: fail, step, continue, retry, next
	// System signals: break, pause, resume, steps-changed
	signal: z.enum([
		"fail", // fail execution
		"step", // single-step mode
		"continue", // continue without debug
		"retry", // retry failed step (rerunStep)
		"next", // skip to next step (nextStep)
		"break",
		"pause",
		"resume",
		STEPS_CHANGED,
	]),
	args: z.record(z.string(), z.unknown()).optional(),
});

// Blip events: a blip records one fine-grained occurrence where it happens. Actuality doesn't retain a blip. A blip uses
// the event transport, but actuality delivers it only to a subscriber that requested its kind. Actuality doesn't narrate a
// blip, so a blip doesn't write a console line or reach a subscriber that doesn't list kinds. lib/domains/blips.ts contains the
// declarations.
export const BlipEvent = BaseEvent.extend({
	kind: z.literal("blip"),
	name: z.string().describe("Declared blip name, dotted and namespaced, e.g. haibun.http.request"),
	seqPath: z.string().optional().describe("The seqPath of the step actuality was executing. An exporter attaches the blip to that step's span."),
	value: z.number().optional().describe("The measured value, in the declaration's unit"),
	attributes: z.record(z.string(), z.unknown()).optional(),
});

// Union Type
export const HaibunEvent = z.union([LifecycleEvent, LogEvent, ArtifactEvent, ControlEvent, BlipEvent]);

export type TLifecycleEvent = z.infer<typeof LifecycleEvent>;
export type TStepEvent = z.infer<typeof StepEvent>;
export type TLogEvent = z.infer<typeof LogEvent>;
export type TArtifactEvent = z.infer<typeof ArtifactEvent>;
export type TImageArtifact = z.infer<typeof ImageArtifact>;
export type TVideoArtifact = z.infer<typeof VideoArtifact>;
export type THtmlArtifact = z.infer<typeof HtmlArtifact>;
export type TSpeechArtifact = z.infer<typeof SpeechArtifact>;
export type TJsonArtifact = z.infer<typeof JsonArtifact>;
export type TMermaidArtifact = z.infer<typeof MermaidArtifact>;
export type THttpTraceArtifact = z.infer<typeof HttpTraceArtifact>;
export type TResolvedFeaturesArtifact = z.infer<typeof ResolvedFeaturesArtifact>;
export type TFileArtifact = z.infer<typeof FileArtifact>;
export type TBlipEvent = z.infer<typeof BlipEvent>;
export type THaibunEvent = z.infer<typeof HaibunEvent>;
export type TEventKind = THaibunEvent["kind"];
