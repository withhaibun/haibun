/**
 * SPA-side schemas for graph query results and shared UI components.
 */
import { z } from "zod";
import { SearchConditionSchema, SortOrderSchema, type TSearchCondition } from "@haibun/core/lib/quad-types.js";
import { AccessQueryLevelSchema } from "@haibun/core/lib/domains/resources.js";
import { CountedSchema } from "@haibun/core/lib/domains/hypermedia.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { ChatStatusSchema, ContextQuerySchema } from "@haibun/core/lib/conversation/domains/conversation.js";

// --- Combobox ---

const ComboboxOptionSchema = z.object({
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
/** The status of the page's turn: idle before the first question, else the status of the turn asked last. */
const TurnStatusSchema = z.enum(["idle", ...ChatStatusSchema.options]);
export type TTurnStatus = z.infer<typeof TurnStatusSchema>;

export const ComboboxSchema = z.object({
	value: z.string(),
	options: z.array(ComboboxOptionSchema),
	placeholder: z.string(),
	/** What the control shows for the value it holds, where its holder states it: the page strip shows the search and
	 *  what it found. Empty, the control shows the chosen option's label. */
	shown: z.string(),
	/** Whether the control takes text that doesn't name an option as a value of its own, offered first as a new entry. */
	accepts: z.boolean(),
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
	return { predicate: parts[0] || "", operator: (parts[1] || "eq") as TSearchCondition["operator"], value: parts[2] || "", ...(parts[3] ? { value2: parts[3] } : {}) };
}

/** Serialize a SearchCondition to a pipe-delimited filter string. */
export function serializeFilterParam(c: TSearchCondition): string {
	const parts = [c.predicate, c.operator, c.value];
	if (c.operator === "between" && c.value2) parts.push(c.value2);
	return parts.join("|");
}

// --- Query view schema (for shu-graph-query component state) ---

export const QueryViewSchema = z.object({ label: z.string().optional(), textQuery: z.string().optional(), sortBy: z.string().optional(), sortOrder: SortOrderSchema });

// --- Context patterns (for LLM / actions bar) ---

// --- Column pane ---

export const ColumnPaneSchema = z.object({
	label: z.string(),
	active: z.boolean(),
	// The pane's share of the strip (0..1), not pixels: a width kept from one window restores sensibly into another, and
	// can never exceed the strip. A stored pixel width fails this and is dropped on restore.
	width: z.number().gt(0).lte(1).optional(),
	// Docked, the pane's open height as a share of the app (0..1), for the same reason its width is a share of the strip.
	height: z.number().gt(0).lte(1).optional(),
	// User-minimized: a persisted choice, distinct from the strip's transient accordion auto-collapse.
	minimized: z.boolean(),
	closable: z.boolean(),
	pinned: z.boolean(),
	// Free-form: the pane strip writes the component tag for component panes; CSS only matches the well-known values.
	columnType: z.string(),
});

// --- Entity column ---

export const EntityColumnSchema = z.object({
	individualId: z.string(),
	persistedAs: z.string(),
	loading: z.boolean(),
	/** How this individual was served: from the in-memory session cache or the persisted browser store (offline), vs a
	 *  live fetch (undefined). Surfaced as a badge so a reader knows the view may be a stored copy, not freshly fetched. */
	fromStore: z.enum(["cache", "offline"]).optional(),
	/** Show annotations anchored in this body inline (on by default). When the body has annotations this renders the
	 *  inline annotated view; off returns to the plain body iframe. Kept per column via persistFields. */
	showAnnotations: z.boolean(),
	/** Enter the inline annotated view to author the first annotation on a body that doesn't have one yet (transient). */
	annotateMode: z.boolean(),
});

// --- Filter column ---

/** A filter column's listing: the records of a type whose property holds a value, or whose edges reach the record
 *  `incoming` names, as the `filter-incoming` pane addresses it. */
export const FilterColumnSchema = z.object({ persistedAs: z.string().optional(), property: z.string().optional(), value: z.string().optional(), incoming: z.string().optional() });

/** The type a reader chooses to search, as the page strip states it. */
export const TypeChoiceSchema = z.object({ key: z.string().min(1) });

// --- Breadcrumb ---

/** What the page's search is called when the reader hasn't selected a record, since the page then acts on everything. */
export const NOTHING_SELECTED_LABEL = "All";

export const BreadcrumbSchema = z.object({ queryLabel: z.string(), columns: z.array(z.string()), activeIndex: z.number(), hasSync: z.boolean() });

// --- Permissions ---

/** What the permissions view keeps: whether the principals this deployment holds are shown. */
export const PermissionsSchema = z.object({ showPrincipals: z.boolean() });

export const PageKeySchema = z.object({
	/** The page's key as a did:key: the key to which a holder delegates. */
	controller: z.string(),
});

// --- Result table ---

export const ResultTableSchema = z.object({
	sortBy: z.string().optional(),
	sortOrder: SortOrderSchema,
	selectable: z.boolean(),
	displayMode: z.enum(["full", "objects", "pairs"]),
	fixedProperty: z.string().optional(),
	total: z.number(),
	limit: z.number(),
	offset: z.number(),
	paginated: z.boolean(),
});

/** What a view states it shows, as the page's actions read it: the patterns, the level at which they are read, and what the
 *  view holds of them. A view states it with `CONTEXT_CHANGE`, and the app checks it against this schema. */
export const PageContextSchema = z.object({
	patterns: ContextQuerySchema,
	readLevel: AccessQueryLevelSchema,
	label: z.string().optional(),
	total: CountedSchema.optional(),
	folder: z.string().optional(),
	textQuery: z.string().optional(),
	conditions: z.array(SearchConditionSchema).optional(),
});
export type TPageContext = z.infer<typeof PageContextSchema>;

/** A step a view requests the actions bar to open with `STEP_CHOOSE`: its method, the arguments it fixes, and whether the
 *  step runs as soon as its caller mounts. */
export const StepChoiceSchema = z.object({ method: z.string().min(1), args: z.record(z.string(), z.unknown()).optional(), auto: z.boolean().optional() });

/** The context that goes with an active record: the patterns an ask about the record carries, and the access level
 *  at which they are read. */
export const BundleSchema = z.object({ patterns: ContextQuerySchema, accessLevel: AccessQueryLevelSchema });

/** A question from the history sent again: its words, the records it was about, the turn it replied to, and whether it
 *  is sent as it was or put in the input to edit. Either way it replies where the question did, as a branch there. */
export const QuestionForkSchema = z.object({ prompt: z.string().min(1), patterns: ContextQuerySchema, inReplyTo: z.string().optional(), send: z.boolean() });
export type TQuestionFork = z.infer<typeof QuestionForkSchema>;
export type TBundle = z.infer<typeof BundleSchema>;

// --- Actions bar ---

/** The actions bar's modes. search browses and filters the graph, and is the default. step runs a haibun step. The ask mode
 *  converses with a model, and the mode control offers it only where actuality registers an ask-capable step. */
export const BAR_MODES = ["search", "ask", "step"] as const;
export const ActionsBarSchema = z.object({ mode: z.enum(BAR_MODES) });

/** The domain of where an instance serves shu. */
export const DOMAIN_SHU_APPS = "shu-apps";
/** Where an instance serves shu: the path of each app it mounted, which a reader opens under the instance's address. */
export const ShuAppsSchema = z.object({ apps: z.array(z.string()).describe("The path of each app this instance serves shu at, under its address.") });
/** The step that states where an instance serves shu. */
export const SHU_APPS_METHOD = stepMethodName("ShuStepper", "showShuApps");
