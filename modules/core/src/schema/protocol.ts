import { z } from "zod";

// ============================================================================
// Constants
// ============================================================================

export const HAIBUN_LOG_LEVELS = ["debug", "trace", "log", "info", "warn", "error"] as const;
export const HaibunLogLevel = z.enum(HAIBUN_LOG_LEVELS);
export type THaibunLogLevel = z.infer<typeof HaibunLogLevel>;

/**
 * Marks, as one related set. Two things vary, and each is carried by one visual property.
 *
 * WEIGHT says how much a line should interrupt a reader. Emoji-weight marks are for what a reader must not scroll
 * past: an outcome, a warning, a stop. Thin glyphs are for what is frequent and unremarkable, so a log of ordinary
 * activity stays quiet and the exceptional line stands out of it. A thin glyph for something exceptional is the fault
 * this rule exists to prevent.
 *
 * SHAPE says what kind of statement the mark makes. A run's verdicts are the check and cross. A claim the run merely
 * tried carries the modal-logic diamond, which reads as possibility rather than as right or broken: filled where it
 * held, hollow where it did not. A call the run handed to something else and got an answer from carries the return
 * arrow: the call did not succeed, but the run is not broken and its caller is expected to act on it. Containers and
 * flow are geometric, since they state structure rather than outcome.
 */

// Verdicts: what the run concluded. Emoji weight, because a verdict is what a reader is looking for.
export const CHECK_YES = "✅";
export const CHECK_NO = "❌";
export const CHECK_YIELD = "🔀";

// Tried, not concluded: `some ... is ...` runs until one matches, `maybe` expects either answer. Neither outcome is a
// fault, so neither uses a verdict mark. Quieter than a verdict on purpose.
export const MAYBE_CHECK_YES = "◆";
export const MAYBE_CHECK_NO = "◇";

// Handed out and answered: a tool call a model made, an RPC. A failure here is returned to its caller to act on, and
// is not the run failing, so it is neither a verdict nor silent.
export const RETURNED_TO_CALLER = "↩️";

// BDD Structure (Geometric Containers)
export const ICON_FEATURE = "⧇"; // Root container (High visibility)
export const ICON_SCENARIO = "⬢"; // Concrete logic node (Solid Hex)

// Step Execution Status: the verdict marks, plus flow for a step still running.
export const ICON_STEP_RUNNING = "⫸"; // Active flow (Clear direction)
export const ICON_STEP_FAILED = CHECK_NO;

/** A statement the run tried speculatively (`maybe`): its failure is the run trying something, not a fault. */
export function isSpeculativeEvent(event: { intent?: { mode?: string } }): boolean {
	return event.intent?.mode === "speculative";
}

/** A call the run handed out — a model's tool call, an RPC — carried by a negative seqPath segment. Its failure is
 *  returned to that caller, which is expected to act on it, so it is not the run failing. */
export function isHandedOutEvent(event: { id?: string }): boolean {
	return String(event.id ?? "")
		.split(".")
		.some((n) => Number.parseInt(n, 10) < 0);
}
export const ICON_STEP_COMPLETED = CHECK_YES;

// Log Levels: info is frequent, so it stays thin; a warning and an error are exceptional, so they carry weight. The
// error mark is distinct from the failure verdict, so a line does not say failure twice in two different hands.
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
	statement = "statement",
}
export type TOrigin = keyof typeof Origin;

export type TDebugSignal = "fail" | "step" | "continue" | "retry" | "next";

/** The level a hidden substep reports at. It is below every level a view shows, so what a substep says, produces and
 *  shows is infrastructure rather than something a reader asked for. */
export const SUBSTEP_LEVEL: THaibunLogLevel = "trace";
/** The level an ordinary step reports at. */
export const STEP_LEVEL: THaibunLogLevel = "info";

/** The level a step reports at. One derivation, so the record of a step, what it says and what it produces all agree. */
export const stepLevel = (isSubStep: boolean): THaibunLogLevel => (isSubStep ? SUBSTEP_LEVEL : STEP_LEVEL);

export const SCENARIO_START = "scenario";
export const FEATURE_START = "feature";

/** How a run's own prose declares a feature and a scenario, which is how a reader of it reads their names back. */
export const DECLARES = { feature: "Feature:", scenario: "Scenario:" } as const;

/** Whether a step declared a feature or a scenario: what it called says which, whichever stepper carried it out. */
export const declaresFeature = (called: string | undefined): boolean => called?.endsWith(`.${FEATURE_START}`) === true;
export const declaresScenario = (called: string | undefined): boolean => called?.endsWith(`.${SCENARIO_START}`) === true;

/** The name a declaring step gives, which is its own words without the word that declares them. */
export const declaredName = (text: string, of: keyof typeof DECLARES): string => text.replace(new RegExp(`^${DECLARES[of]}\\s*`), "").trim();

/** How a lifecycle event says a step, feature or execution ended. */
export const LIFECYCLE_STATUS = { running: "running", completed: "completed", failed: "failed", skipped: "skipped" } as const;
export const LIFECYCLE_STATUS_SCHEMA = z.enum([LIFECYCLE_STATUS.running, LIFECYCLE_STATUS.completed, LIFECYCLE_STATUS.failed, LIFECYCLE_STATUS.skipped]);

export const STAY_ALWAYS = "always";
export const STAY_FAILURE = "failure";
export const STAY = "STAY";
/** Report events as NDJSON on stdout. Declared here so the option, the env name a launcher writes, and the logger
 *  that reads it all say it once. */
export const NDJSON = "NDJSON";

export const STEP_DELAY = "STEP_DELAY";
export const DEFAULT_DEST = "default";
export const TEST_BASE = "test_base";
export const CONTINUE_AFTER_ERROR = "CONTINUE_AFTER_ERROR";

export const HAIBUN = "HAIBUN";
export const BASE_PREFIX = `${HAIBUN}_`;
export const CAPTURE = "capture";

export const TEND_FEATURE_DEFAULTS = {
	shouldClose: true,
	isLast: true,
	okSoFar: true,
	continueAfterError: true,
	stayOnFailure: true,
	thisFeatureOK: true,
};

// ============================================================================
// Utilities
// ============================================================================

export type TAnyFixme = unknown;

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
// Serialization
// ============================================================================

interface JITSchema {
	_meta: "schema";
	id: string;
	fields: string[];
}

interface JITData {
	s: string;
	d: unknown[];
}

export class JITSerializer {
	private schemas = new Map<string, string[]>();
	private nextSchemaId = 1;

	serialize(events: THaibunEvent[]): string {
		const lines: string[] = [];
		this.schemas.clear();
		this.nextSchemaId = 1;

		for (const event of events) {
			const schemaId = this.getSchemaId(event);
			const schemaFields = this.schemas.get(schemaId);

			// If first use of this schema, emit definition
			if (!lines.some((l) => l.includes(`"_meta":"schema","id":"${schemaId}"`))) {
				lines.push(
					JSON.stringify({
						_meta: "schema",
						id: schemaId,
						fields: schemaFields,
					}),
				);
			}

			// Emit data
			const validFields = schemaFields.map((f) => (event as Record<string, unknown>)[f]);
			lines.push(JSON.stringify({ s: schemaId, d: validFields }));
		}

		return lines.join("\n");
	}

	deserialize(input: string): THaibunEvent[] {
		const lines = input.split("\n").filter(Boolean);
		const schemas = new Map<string, string[]>();
		const events: THaibunEvent[] = [];

		for (const line of lines) {
			try {
				const obj = JSON.parse(line) as JITSchema | JITData;
				if ("_meta" in obj && obj._meta === "schema") {
					schemas.set(obj.id, obj.fields);
				} else if ("s" in obj && "d" in obj) {
					const fields = schemas.get(obj.s);
					if (fields) {
						const event: Record<string, unknown> = {};
						fields.forEach((field, i) => {
							event[field] = obj.d[i];
						});
						events.push(event as THaibunEvent);
					}
				}
			} catch (e) {
				console.error("Failed to parse JIT line", line, e);
			}
		}
		return events;
	}

	private getSchemaId(event: THaibunEvent): string {
		const keys = Object.keys(event).sort();
		const signature = keys.join(",");

		for (const [id, fields] of this.schemas.entries()) {
			if (fields.join(",") === signature) {
				return id;
			}
		}

		const newId = `${event.kind}-${this.nextSchemaId++}`;
		this.schemas.set(newId, keys);
		return newId;
	}
}

// ============================================================================
// Formatting
// ============================================================================

export type TIndication = "success" | "failure" | "speculative-failure" | "pending" | "neutral";

export class EventFormatter {
	static shouldDisplay(event: THaibunEvent, minLevel: THaibunLogLevel = "info"): boolean {
		const minLevelIndex = HAIBUN_LOG_LEVELS.indexOf(minLevel);
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
		if (event.status === "completed") return isSpeculativeEvent(event) ? ` ${MAYBE_CHECK_YES}` : ICON_STEP_COMPLETED;
		if (event.status === "failed") return isSpeculativeEvent(event) ? ` ${MAYBE_CHECK_NO}` : isHandedOutEvent(event) ? RETURNED_TO_CALLER : ICON_STEP_FAILED;
		if (event.status === "running") return ICON_STEP_RUNNING;
		return ` ${ICON_DEFAULT}`;
	}

	static getIndication(event: THaibunEvent & { kind: "lifecycle" }): TIndication {
		if (event.status === "completed") return "success";
		if (event.status === "failed") return isSpeculativeEvent(event) ? "speculative-failure" : "failure";
		if (event.status === "running") return "pending";
		return "neutral";
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
				// Step always has 'in', other events (activity, etc) may not
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
			const levelIcons: Record<string, string> = {
				info: ICON_LOG_INFO,
				warn: ICON_LOG_WARN,
				error: ICON_LOG_ERROR,
			};
			icon = levelIcons[event.level] || ICON_DEFAULT;
			id = event.id ? `${event.id}` : "";
			message = event.message;
		}
		return { time, emitter, level, showLevel, icon, id, message };
	}

	static formatLine(event: THaibunEvent, lastLevel?: string): string {
		const { time, emitter, showLevel, icon, id, message } = this.formatLineElements(event, lastLevel);
		const prefix = showLevel.padStart(8) + ` █ ${time}:${emitter}`.padEnd(40) + ` ｜ `;
		// A step's path is bracketed where a line shows it, which is a way of reading it rather than a second way of
		// writing it: an id is one form everywhere it is stored or matched.
		return prefix + `${icon} ${id ? `[${id}] ` : ""}${message}`;
	}
}

// ============================================================================
// Execution Protocol
// ============================================================================

/**
 * How a statement's outcome is to be taken: the run asserting something, or a try whose failure is expected and is
 * therefore not the run failing. One axis with two ends, which is why every reader of it asks only which of the two.
 *
 * Whether a line is prose at all is a different question, about what the line IS rather than how its outcome counts,
 * and it is answered where that belongs (document-content classifies a line as prose or technical). A prose line runs
 * nothing, so it has no outcome to take either way and never reaches here.
 */
export const EXECUTION_MODES = ["authoritative", "speculative"] as const;
export type TExecutionMode = (typeof EXECUTION_MODES)[number];

export const ExecutionIntentSchema = z.object({
	mode: z.enum(EXECUTION_MODES).default("authoritative"),
	usage: z.enum(["testing", "debugging", "background", "polling"]).optional(),
	stepperOptions: z.record(z.string(), z.unknown()).optional(),
});
export type ExecutionIntent = z.infer<typeof ExecutionIntentSchema>;

export const SystemMessageSchema = z.object({
	topic: z.string().optional(),
	intent: ExecutionIntentSchema,
});
export type SystemMessage = z.infer<typeof SystemMessageSchema>;

/** Execution trace field on products. */
export const TRACE_SEQ_PATH = "_seqPath";

/** Hypermedia product field keys. Use these constants instead of string literals. */
export const HYPERMEDIA = {
	/** Domain label for this result (e.g. "Email", "Contact") */
	TYPE: "_type",
	/** Human-readable one-liner for CLI output and document view captions */
	SUMMARY: "_summary",
	/** Inline description from the registered domain schema's `.describe()`. Travels with the data so a consumer (human, LLM, agent) can interpret a product without round-tripping to `step.list`. Unset when the producing step's domain has no description. */
	DESCRIPTION: "_description",
	/** Web component tag that renders this product (e.g. "shu-monitor-column") */
	COMPONENT: "_component",
	/** HATEOAS affordances — what can be done next, keyed by rel */
	LINKS: "_links",
	/** For destructive operations: condition to check reversibility, apply to execute undo */
	UNDO: "_undo",
} as const;

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
 * The single result type for step execution. Used everywhere:
 * step actions, FlowRunner, feature loop, RPC transports.
 */
export type TActionResult = {
	ok: boolean;
	errorMessage?: string;
	products?: THypermediaProducts;
	controlSignal?: TDebugSignal;
	artifact?: TArtifactEvent;
	protocol?: SystemMessage;
};

export const OK: TActionResult = { ok: true };

export type TStepValueValue = unknown;
export type TStepArgs = Record<string, TStepValueValue>;

export type TStepValue = {
	term: string;
	domain: string;
	value?: TStepValueValue;
	origin: TOrigin;
	readonly?: boolean;
	secret?: boolean;
};

export type TProvenanceIdentifier = {
	in?: string;
	seq: number[];
	when: string;
};

// Result Types
export type TTrace = {
	[name: string]: {
		url: string;
		since: number;
		trace: TAnyFixme;
	};
};

export type TSeqPath = number[];

/**
 * Step result with execution trace metadata.
 * Extends TActionResult with context about where/when the step ran.
 */
export type TStepResult = TActionResult & {
	name: string;
	in: string;
	path: string;
	lineNumber?: number;
	seqPath: TSeqPath;
	intent?: ExecutionIntent;
	start?: number;
	end?: number;
	traces?: TTrace[];
};

/**
 * What a feature's steps came to, as a fold over them rather than a list of them.
 *
 * A feature that services requests for weeks runs more steps than a process can hold, and what a reader of the result
 * asks is how many ran, when they began and ended, and which one failed. Each is answered as the feature runs, so the
 * answer costs the same whether the feature ran ten steps or ten million.
 */
export type TFeatureSteps = {
	/** How many the feature ran. */
	count: number;
	/** When the first began, and when the last ended. */
	firstStart?: number;
	lastEnd?: number;
	/**
	 * The step the run reports as having failed. A synthetic dispatch (a negative seqPath segment: a model's tool call,
	 * an RPC) can fail and be recovered from inside the step that made it, and a speculative statement's failure is
	 * expected, so a feature step that failed is reported ahead of either. With nothing else, the first failure is what
	 * there is to report.
	 */
	failed?: TStepResult;
};

export type TFeatureResult = {
	skip?: boolean;
	path: string;
	ok: boolean;
	/** What its steps came to. */
	steps: TFeatureSteps;
	/** The steps a reader can still read in full: the most recent the feature ran, and no more than that. */
	stepResults: TStepResult[];
	failure?: {
		message: string;
		error: TAnyFixme;
		expected?: TAnyFixme;
	};
};

export type TExecutorResult = {
	ok: boolean;
	tag: unknown;
	shared: unknown;
	featureResults?: TFeatureResult[];
	failure?: {
		stage: string;
		error: {
			details: Record<string, TAnyFixme>;
			message: string;
		};
	};
	steppers?: unknown[];
};

// ============================================================================
// Prompt Types
// ============================================================================

export const Prompt = z.object({
	id: z.string(),
	message: z.string(),
	context: z.unknown().optional(),
	options: z.array(z.string()).optional(),
});
export type TPrompt = z.infer<typeof Prompt>;

// ============================================================================
// Event Schema
// ============================================================================

export const BaseEvent = z.object({
	id: z.string().describe("Unique identifier for the event, typically the seqPath"),
	timestamp: z.number().int().describe("Absolute epoch timestamp in milliseconds"),
	source: z.string().default("haibun").describe("Source of the event"),
	emitter: z.string().optional().describe("Code location that emitted the event (e.g. Executor:238)"),
	level: HaibunLogLevel.default("info").describe("Log level for filtering"),
});

// Lifecycle Events
export const LifecycleEventCommon = BaseEvent.extend({
	kind: z.literal("lifecycle"),
	stage: z.enum(["start", "end"]),

	// Execution Context
	status: LIFECYCLE_STATUS_SCHEMA.optional(),
	error: z.string().optional(),

	// Execution Intent
	intent: z
		.object({
			mode: z.enum(["speculative", "authoritative"]).optional(),
		})
		.optional(),
});

// Specific Events
export const FeatureEvent = LifecycleEventCommon.extend({
	type: z.literal("feature"),
	featurePath: z.string().describe("Feature file path"),
	featureName: z.string().describe("Feature display name"),
});

export const ScenarioEvent = LifecycleEventCommon.extend({
	type: z.literal("scenario"),
	scenarioName: z.string().describe("Scenario name"),
	featurePath: z.string().optional(),
});

export const StepEvent = LifecycleEventCommon.extend({
	type: z.literal("step"),
	in: z.string().describe("Step text"),
	lineNumber: z.number().optional(),
	stepperName: z.string().optional(),
	actionName: z.string().optional(),
	stepArgs: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
	stepValuesMap: z.record(z.string(), z.unknown()).optional(),
	products: z.record(z.string(), z.unknown()).optional(),
	isAsync: z.boolean().optional(),
	featurePath: z.string().optional(),
});

// For other types (activity, waypoint, ensure, execution)
export const GenericLifecycleEvent = LifecycleEventCommon.extend({
	type: z.enum(["activity", "waypoint", "ensure", "execution"]),
	in: z.string().optional(),
	products: z.record(z.string(), z.unknown()).optional(),
	lineNumber: z.number().optional(),
	featurePath: z.string().optional(),
});

export const LifecycleEvent = z.union([FeatureEvent, ScenarioEvent, StepEvent, GenericLifecycleEvent]);

// Log Events
export const LogEvent = BaseEvent.extend({
	kind: z.literal("log"),
	level: HaibunLogLevel,
	message: z.string(),
	attributes: z.record(z.string(), z.unknown()).optional(), // Structured log data
});

// Artifact Events - Base
const BaseArtifact = BaseEvent.extend({
	kind: z.literal("artifact"),
	/** How prominently the run reports it. What a run produced is read at every level, since the row of the step that
	 *  produced it is what shows it, so this says where it reports rather than whether a reader is shown it. */
	level: HaibunLogLevel.default("info"),
	// Path relative to the feature dir (e.g. "./image/x.png"). The serialized report's shu.html lives in that dir, so it
	// references artifacts by this short relative path; `path` carries the base-relative form for the live /artifacts route.
	featureRelativePath: z.string().optional(),
});

// Artifact Subtypes
export const ImageArtifact = BaseArtifact.extend({
	artifactType: z.literal("image"),
	path: z.string(),
	mimetype: z.string().default("image/png"),
});

export const VideoArtifact = BaseArtifact.extend({
	artifactType: z.literal("video"),
	path: z.string(),
	mimetype: z.string().default("video/webm"),
	isTimeLined: z.boolean().default(true),
	startTime: z.number().optional().describe("Epoch timestamp when video recording started"),
	duration: z.number().optional(),
});

export const VideoStartArtifact = BaseArtifact.extend({
	artifactType: z.literal("video-start"),
	startTime: z.number().describe("Relative start time of video in milliseconds"),
});

export const HtmlArtifact = BaseArtifact.extend({
	artifactType: z.literal("html"),
	path: z.string(),
	mimetype: z.string().default("text/html"),
});

export const SpeechArtifact = BaseArtifact.extend({
	artifactType: z.literal("speech"),
	path: z.string(),
	mimetype: z.string().default("audio/mpeg"),
	transcript: z.string().optional(),
	durationS: z.number().optional(),
});

export const JsonArtifact = BaseArtifact.extend({
	artifactType: z.literal("json"),
	json: z.record(z.string(), z.unknown()),
	mimetype: z.string().default("application/json"),
});

export const MermaidArtifact = BaseArtifact.extend({
	artifactType: z.literal("mermaid"),
	source: z.string(),
	mimetype: z.string().default("text/x-mermaid"),
});

export const HttpTraceArtifact = BaseArtifact.extend({
	artifactType: z.literal("http-trace"),
	httpEvent: z.enum(["request", "response", "route"]),
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


export const RegisteredOutcomeEntry = z.object({
	proofStatements: z.array(z.string()).optional(),
	proofPath: z.string().optional(),
	isBackground: z.boolean().optional(),
	activityBlockSteps: z.array(z.string()).optional(),
});
export type TRegisteredOutcomeEntry = z.infer<typeof RegisteredOutcomeEntry>;

export const ResolvedFeaturesArtifact = BaseArtifact.extend({
	artifactType: z.literal("resolvedFeatures"),
	resolvedFeatures: z.array(z.unknown()),
	index: z.number().optional(),
	registeredOutcomes: z.record(z.string(), RegisteredOutcomeEntry).optional(),
	mimetype: z.string().default("application/json"),
});

// Generic file artifact for other types
export const FileArtifact = BaseArtifact.extend({
	artifactType: z.literal("file"),
	path: z.string(),
	mimetype: z.string(),
});

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

// Control Events
export const ControlEvent = BaseEvent.extend({
	kind: z.literal("control"),
	// Debugger signals: fail, step, continue, retry, next
	// System signals: graph-link, break, pause, resume
	signal: z.enum([
		"fail", // fail execution
		"step", // single-step mode
		"continue", // continue without debug
		"retry", // retry failed step (rerunStep)
		"next", // skip to next step (nextStep)
		"graph-link",
		"break",
		"pause",
		"resume",
	]),
	args: z.record(z.string(), z.unknown()).optional(),
});

// Blip Events: one fine-grained occurrence, recorded where it happens and never retained by the run. A blip shares the
// event transport but not the audience: it is delivered only to a subscriber that asked for its kind, and it is never
// narrated (no console line, no bare subscriber). Declarations live in lib/blips.ts.
export const BlipEvent = BaseEvent.extend({
	kind: z.literal("blip"),
	name: z.string().describe("Declared blip name, dotted and namespaced, e.g. haibun.http.request"),
	seqPath: z.string().optional().describe("The step the run was executing, so an exporter attaches this to that step's span"),
	value: z.number().optional().describe("The measured value, in the declaration's unit"),
	attributes: z.record(z.string(), z.unknown()).optional(),
});

// Union Type
export const HaibunEvent = z.union([LifecycleEvent, LogEvent, ArtifactEvent, ControlEvent, BlipEvent]);

export type TBaseEvent = z.infer<typeof BaseEvent>;
export type TLifecycleEvent = z.infer<typeof LifecycleEvent>;
export type TFeatureEvent = z.infer<typeof FeatureEvent>;
export type TScenarioEvent = z.infer<typeof ScenarioEvent>;
export type TStepEvent = z.infer<typeof StepEvent>;
export type TGenericLifecycleEvent = z.infer<typeof GenericLifecycleEvent>;

export type TLogEvent = z.infer<typeof LogEvent>;
export type TArtifactEvent = z.infer<typeof ArtifactEvent>;
export type TImageArtifact = z.infer<typeof ImageArtifact>;
export type TVideoArtifact = z.infer<typeof VideoArtifact>;
export type TVideoStartArtifact = z.infer<typeof VideoStartArtifact>;
export type THtmlArtifact = z.infer<typeof HtmlArtifact>;
export type TSpeechArtifact = z.infer<typeof SpeechArtifact>;
export type TJsonArtifact = z.infer<typeof JsonArtifact>;
export type TMermaidArtifact = z.infer<typeof MermaidArtifact>;
export type THttpTraceArtifact = z.infer<typeof HttpTraceArtifact>;
export type TResolvedFeaturesArtifact = z.infer<typeof ResolvedFeaturesArtifact>;
export type TFileArtifact = z.infer<typeof FileArtifact>;
export type TControlEvent = z.infer<typeof ControlEvent>;
export type TBlipEvent = z.infer<typeof BlipEvent>;
export type THaibunEvent = z.infer<typeof HaibunEvent>;
export type TEventKind = THaibunEvent["kind"];
