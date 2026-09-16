/**
 * SPA-side schemas for graph query results and shared UI components.
 */
import { z } from "zod";
import { SearchConditionSchema, type TSearchCondition } from "@haibun/core/lib/quad-types.js";
import { DENOTES } from "@haibun/core/lib/typed-links.js";
import { AccessQueryLevelSchema } from "@haibun/core/lib/resources.js";

// --- Combobox ---

export const ComboboxOptionSchema = z.object({
	value: z.string(),
	label: z.string(),
	/**
	 * Optional secondary line shown below the label as smaller, dimmer text.
	 * Carries the "what does this represent" detail, input/output domain
	 * summary for a step option, the type or distinguishing field for a
	 * persisted-ref option. Filter matches on label OR secondary so either the
	 * visible label or a contextual hint can be typed.
	 */
	secondary: z.string().optional(),
	/**
	 * Optional expanded-detail block shown when the option is focused
	 * (keyboard) or hovered (mouse). Multiple lines welcome, full step gwta
	 * with inputs / outputs, or every persisted field of a node. Rendered in a
	 * panel adjacent to the dropdown to show what an option holds before it is
	 * picked.
	 */
	details: z.string().optional(),
	/**
	 * Optional section heading. Consecutive options sharing a `group` are
	 * rendered under one non-selectable header in the dropdown, e.g.
	 * "Declared" vs "Built-in" types in the type selector.
	 */
	group: z.string().optional(),
});
export type TComboboxOption = z.infer<typeof ComboboxOptionSchema>;

/** The author of a chat message: the reader's question or the model's reply. */
export const ChatRoleSchema = z.enum(["user", "llm"]);
export type TChatRole = z.infer<typeof ChatRoleSchema>;
/** The status of an asked chat turn, which its reply message shows. */
export const ChatStatusSchema = z.enum(["asking", "running", "completed", "failed", "stopped"]);
export type TChatStatus = z.infer<typeof ChatStatusSchema>;
/** The status of the page's turn: idle before the first question, else the status of the turn asked last. */
export const TurnStatusSchema = z.enum(["idle", ...ChatStatusSchema.options]);
export type TTurnStatus = z.infer<typeof TurnStatusSchema>;

export const ComboboxSchema = z.object({
	value: z.string().default(""),
	options: z.array(ComboboxOptionSchema).default([]),
	placeholder: z.string(),
	filterText: z.string().default(""),
	open: z.boolean().default(false),
});

// --- Search conditions ---

/** The operator options a filter UI offers, each with its display label. Values come from the condition schema, so the menu cannot offer an operator the query rejects. */
export const SEARCH_OPERATORS: ReadonlyArray<{ value: TSearchCondition["operator"]; label: string }> = SearchConditionSchema.shape.operator.options.map((value) => ({
	value,
	label: { eq: "equals", contains: "contains", gt: "greater than", lt: "less than", gte: "at least", lte: "at most", between: "between", in: "any of" }[value],
}));

/** Parse a pipe-delimited filter string (predicate|operator|value[|value2]) into a SearchCondition. */
export function parseFilterParam(f: string): TSearchCondition {
	const parts = f.split("|");
	return {
		predicate: parts[0] || "",
		operator: (parts[1] || "eq") as TSearchCondition["operator"],
		value: parts[2] || "",
		...(parts[3] ? { value2: parts[3] } : {}),
	};
}

/** Serialize a SearchCondition to a pipe-delimited filter string. */
export function serializeFilterParam(c: TSearchCondition): string {
	const parts = [c.predicate, c.operator, c.value];
	if (c.operator === "between" && c.value2) parts.push(c.value2);
	return parts.join("|");
}

// --- Query view schema (for shu-graph-query component state) ---

export const QueryViewSchema = z.object({
	label: z.string().optional(),
	textQuery: z.string().optional(),
	sortBy: z.string().optional(),
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// --- Context patterns (for LLM / actions bar) ---

// --- Column pane ---

export const ColumnPaneSchema = z.object({
	label: z.string(),
	active: z.boolean().default(false),
	// The pane's share of the strip (0..1), not pixels: a width kept from one window restores sensibly into another, and
	// can never exceed the strip. A stored pixel width fails this and is dropped on restore.
	width: z.number().gt(0).lte(1).optional(),
	// User-minimized: a persisted choice, distinct from the strip's transient accordion auto-collapse.
	minimized: z.boolean().default(false),
	closable: z.boolean().default(true),
	pinned: z.boolean().default(false),
	// Free-form: PaneState writes the component tag for component panes; CSS only matches the well-known values.
	columnType: z.string().default("query"),
});

// --- Entity column ---

export const EntityColumnSchema = z.object({
	individualId: z.string(),
	persistedAs: z.string(),
	loading: z.boolean().default(false),
	error: z.string().optional(),
	/** How this individual was served: from the in-memory session cache or the persisted browser store (offline), vs a
	 *  live fetch (undefined). Surfaced as a badge so a reader knows the view may be a stored copy, not freshly fetched. */
	fromStore: z.enum(["cache", "offline"]).optional(),
	/** Show annotations anchored in this body inline (on by default). When the body has annotations this renders the
	 *  inline annotated view; off returns to the plain body iframe. Remembered per column via persistFields. */
	showAnnotations: z.boolean().default(true),
	/** Enter the inline annotated view to author the first annotation on a body that has none yet (transient). */
	annotateMode: z.boolean().default(false),
});

// --- Filter column ---

export const FilterColumnSchema = z.object({
	persistedAs: z.string().optional(),
	property: z.string().optional(),
	value: z.string().optional(),
	loading: z.boolean().default(false),
	error: z.string().optional(),
});

// --- Breadcrumb ---

export const BreadcrumbSchema = z.object({
	queryLabel: z.string().default("All"),
	columns: z.array(z.string()).default([]),
	activeIndex: z.number().default(0),
	hasSync: z.boolean().default(false),
});

// --- Column strip ---

export const ColumnStripSchema = z.object({});

// --- Theme switch ---

/** What the permissions view remembers: whether the grants behind this reader's own authority are shown. */
export const PermissionsSchema = z.object({
	showGrants: z.boolean().default(false),
	showPrincipals: z.boolean().default(false),
});

export const ThemeSwitchSchema = z.object({
	theme: z.enum(["auto", "light", "dark"]),
	scale: z.string(),
});

// --- Result table ---

export const ResultTableSchema = z.object({
	sortBy: z.string().optional(),
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
	selectable: z.boolean().default(true),
	displayMode: z.enum(["full", "objects", "pairs"]).default("full"),
	fixedProperty: z.string().optional(),
	total: z.number().default(0),
	limit: z.number().default(100),
	offset: z.number().default(0),
	paginated: z.boolean().default(false),
});

// --- What an ask is about ---

/**
 * An individual is named by the type it is persisted as and its own id, the pair every surface names one by, so
 * whoever resolves it reads it directly. A type names its members, narrowed by the conditions given. `kind` tells the
 * two apart in the words core already names them by, so a surface holding only a type can say nothing else.
 */
const ContextIndividualSchema = z.object({
	kind: z.literal(DENOTES.individual),
	persistedAs: z.string().describe("The type the individual is persisted as."),
	id: z.string().describe("The individual's id within that type."),
});
const ContextTypeSchema = z.object({
	kind: z.literal(DENOTES.type),
	persistedAs: z.string().describe("The type whose members the ask is about."),
	conditions: z.array(SearchConditionSchema).default([]).describe("What every member must match, in the same conditions the query surface and the store already take."),
});
export const ContextPatternSchema = z.discriminatedUnion("kind", [ContextIndividualSchema, ContextTypeSchema]);
export type TContextIndividual = z.infer<typeof ContextIndividualSchema>;
export type TContextPattern = z.infer<typeof ContextPatternSchema>;
export const ContextQuerySchema = z.array(ContextPatternSchema);

/** The context that goes with an active record: the patterns an ask about the record carries, and the access level
 *  they are read at. */
export const BundleSchema = z.object({ patterns: ContextQuerySchema, accessLevel: AccessQueryLevelSchema });
export type TBundle = z.infer<typeof BundleSchema>;

/**
 * A turn of a session as the store reads it back. A turn is named by its question's record, which is what a page is
 * told the run recorded, so a page addresses a turn, the turn it replies to and the session it is in without knowing
 * how a run names what it records.
 */
export const SessionTurnSchema = z
	.object({
		prompt: z.string().describe("What the reader asked."),
		response: z.string().describe("What the model answered; empty before it answered."),
		askId: z.string().describe("The question's record, which names the turn."),
		sayId: z.string().optional().describe("The answer's record, once there is one."),
		inReplyTo: z.string().optional().describe("The question record of the turn this one replies to; unset for a session's first turn."),
		bundle: ContextQuerySchema.describe("The records the question referenced, which a page makes active again when a reader selects the turn."),
		status: ChatStatusSchema.describe("How the step the turn ran as stands: running, completed, failed, or stopped by its reader."),
		error: z.string().optional().describe("What the step failed with, where it failed."),
	})
	.strict();
export type TSessionTurn = z.infer<typeof SessionTurnSchema>;
/** A session's turns as the store reads them back, in the order they were asked, so the last is the latest. A step's
 *  products carry the step they came from beside what the step declares, so the answer is not strict; each turn is. */
export const SessionReadSchema = z.object({ turns: z.array(SessionTurnSchema) });
/** The sessions the store holds, each named by its first question's record, newest first. */
export const SessionListSchema = z.object({ sessions: z.array(z.object({ session: z.string(), label: z.string(), generatedAtTime: z.string() }).strict()) });

/** Who reads a turn's records: the run, which sends them, or the model, which is sent the calls that read them. */
export const ContextReadBySchema = z.enum(["run", "model"]);

/** What a turn sends beside its question: the patterns of the records it is about, the page's view, how many calls its
 *  model may chain, who reads the records, and the session and turn it replies in, each named by a question record.
 *  Strict, so a key a sender renamed is refused rather than dropped. */
export const TurnEnvelopeSchema = z
	.object({
		patterns: ContextQuerySchema,
		viewLd: z.array(z.record(z.string(), z.unknown())).default([]),
		maxToolCalls: z.number().int().min(0).max(99).optional(),
		contextReadBy: ContextReadBySchema.optional(),
		session: z.string().optional(),
		inReplyTo: z.string().optional(),
	})
	.strict()
	.refine((envelope) => envelope.inReplyTo === undefined || envelope.session !== undefined, { message: "a reply names the session it replies in", path: ["session"] });
export type TTurnEnvelope = z.input<typeof TurnEnvelopeSchema>;

/** The ask is about one individual. */
export const anIndividual = (persistedAs: string, id: string): TContextIndividual => ({ kind: DENOTES.individual, persistedAs, id });

/** The ask is about a type: its members, narrowed by whichever conditions carry both a field and a value. The
 *  conditions travel as they were asked, so an operator the reader chose reaches the store that can read it. */
export const aType = (persistedAs: string, conditions: readonly TSearchCondition[] = []): TContextPattern => ({
	kind: DENOTES.type,
	persistedAs,
	conditions: conditions.filter((c) => c.predicate && c.value),
});

// --- Actions bar ---

export const ActionsBarSchema = z.object({
	askExpanded: z.boolean().default(false),
	// Pinned keeps the bar open: an unpinned open bar dismisses on click-away, a pinned one stays put.
	pinned: z.boolean().default(false),
	// search: browse/filter the graph (the default). step: run a haibun step. ask: LLM chat, present only when an
	// ask-capable step is registered (the extension system), so the mode-select offers it conditionally.
	mode: z.enum(["search", "ask", "step"]).default("search"),
	// The expanded overlay's height as a FRACTION of its container (0..1), so a dragged size stays proportionate
	// across window sizes. Persisted like every other remembered option, through persistFields.
	heightProportion: z.number().gt(0).lt(1).default(0.38),
});
