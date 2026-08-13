/**
 * SPA-side schemas for graph query results and shared UI components.
 */
import { z } from "zod";
import { SearchConditionSchema, type TSearchCondition } from "@haibun/core/lib/quad-types.js";

// --- Combobox ---

export const ComboboxOptionSchema = z.object({
	value: z.string(),
	label: z.string(),
	/**
	 * Optional secondary line shown below the label as smaller, dimmer text.
	 * Carries the "what does this represent" detail — input/output domain
	 * summary for a step option, the type or distinguishing field for a
	 * persisted-ref option. Filter matches on label OR secondary so either the
	 * visible label or a contextual hint can be typed.
	 */
	secondary: z.string().optional(),
	/**
	 * Optional expanded-detail block shown when the option is focused
	 * (keyboard) or hovered (mouse). Multiple lines welcome — full step gwta
	 * with inputs / outputs, or every persisted field of a node. Rendered in a
	 * panel adjacent to the dropdown to show what an option holds before it is
	 * picked.
	 */
	details: z.string().optional(),
	/**
	 * Optional section heading. Consecutive options sharing a `group` are
	 * rendered under one non-selectable header in the dropdown — e.g.
	 * "Declared" vs "Built-in" types in the type selector.
	 */
	group: z.string().optional(),
});
export type TComboboxOption = z.infer<typeof ComboboxOptionSchema>;

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
	label: { eq: "equals", contains: "contains", gt: "greater than", lt: "less than", gte: "at least", lte: "at most", between: "between" }[value],
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
	// User-minimized — a persisted choice, distinct from the strip's transient accordion auto-collapse.
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

// --- Triple pattern queries ---
// Canonical query shape across the system: a list of SPO triple patterns, AND-conjoined.
// Omitted position = variable; equality is implicit.
// Used end-to-end: SPA selection → LLM context resolution, _links.params for relational affordances,
// goal resolver backward chaining.

export const ContextPatternSchema = z.object({
	s: z.string().optional(),
	p: z.string().optional(),
	o: z.string().optional(),
});
export type TContextPattern = z.infer<typeof ContextPatternSchema>;
export const ContextQuerySchema = z.array(ContextPatternSchema);

// --- Actions bar ---

export const ActionsBarSchema = z.object({
	askExpanded: z.boolean().default(false),
	// Pinned keeps the bar open: an unpinned open bar dismisses on click-away, a pinned one stays put.
	pinned: z.boolean().default(false),
	// search: browse/filter the graph (the default). step: run a haibun step. ask: LLM chat, present only when an
	// ask-capable step is registered (the extension system), so the mode-select offers it conditionally.
	mode: z.enum(["search", "ask", "step"]).default("search"),
});
