/**
 * The kinds of pane (SH26): each kind's column entry, its address, the component that shows it, its label, the column type
 * its pane is marked with, how an entry with its prefix parses, and how a request for a pane that is open updates its view.
 * A pane carries only what identifies it; its id, tag and label derive from its kind.
 */
import { z } from "zod";
import { PartSchema, type TPart } from "@haibun/core/lib/domains/resources.js";
import { ActionSchema } from "@haibun/core/lib/domains/actions.js";
import { StepMethodSchema } from "@haibun/core/lib/steps/domains/step-method.js";
import { PART_DIRECTIVE, partDirectiveFor, splitPart } from "@haibun/core/lib/domains/typed-links.js";
import { SHU_ATTR, SHU_TAG } from "../../domains/elements.js";
import { splitPaneEntry } from "./address.js";
import { objectId } from "./record-fields.js";

const FlagSchema = z.enum(["min", "max"]).optional();
/** Where a pane stands: minimized or maximized, and docked along the bottom of the page or a column. */
const PLACEMENT = { flag: FlagSchema, docked: z.boolean().optional() };
/** The fields of a pane that shows a record by its type and id, and its placement. */
const OF_SUBJECT = { persistedAs: z.string(), subject: z.string(), ...PLACEMENT };
const TagSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const DesiredPaneSchema = z.discriminatedUnion("paneType", [
	z.object({ paneType: z.literal("component"), tag: TagSchema, label: z.string(), data: z.record(z.string(), z.unknown()).optional(), ...PLACEMENT }),
	z.object({
		paneType: z.literal("entity"),
		id: z.string(),
		persistedAs: z.string(),
		label: z.string().optional(),
		// A part of the record to show, a quoted passage or a fragment of its media. The pane is the record, so a second
		// reference into the same record opens the same pane.
		selector: PartSchema.optional(),
		...PLACEMENT,
	}),
	z.object({ paneType: z.literal("type"), persistedAs: z.string(), ...PLACEMENT }),
	z.object({ paneType: z.literal("filter-eq"), persistedAs: z.string(), predicate: z.string(), value: z.string(), ...PLACEMENT }),
	z.object({ paneType: z.literal("filter-prop"), persistedAs: z.string(), predicate: z.string(), ...PLACEMENT }),
	z.object({ paneType: z.literal("filter-incoming"), ...OF_SUBJECT }),
	z.object({ paneType: z.literal("thread"), ...OF_SUBJECT }),
	/** A step as actuality declares it, by its method. */
	z.object({ paneType: z.literal("step"), method: StepMethodSchema, ...PLACEMENT }),
	/** An action a caller holds, by what it allows. */
	z.object({ paneType: z.literal("action"), action: ActionSchema, ...PLACEMENT }),
	z.object({ paneType: z.literal("views-picker"), views: z.array(z.object({ id: z.string(), description: z.string(), component: z.string() })), label: z.string(), ...PLACEMENT }),
]);

export type DesiredPane = z.infer<typeof DesiredPaneSchema>;
export type DesiredPaneType = DesiredPane["paneType"];
export type TPaneFlag = DesiredPane["flag"];

/** The pane a view in another bundle opens through `SHU_EVENT.PANE_OPEN`, since the page holds its panes in its own bundle. */
export const PaneOpenSchema = z.object({ pane: DesiredPaneSchema, addToSelection: z.boolean() });
export type TPaneOpen = z.infer<typeof PaneOpenSchema>;

/** Whether a click adds the pane it opens beside the others: a click with a modifier does, and a plain click replaces the
 *  panes to the right of the pane where it was made. */
export const addsToSelection = (e?: MouseEvent): boolean => Boolean(e && (e.ctrlKey || e.shiftKey || e.metaKey));

/** What a pane's kind reads from the catalog: the component a type's records open in, and a component's title. */
export type TPaneContext = { recordComponent(type: string): string | undefined; componentTitle(tag: string): string };

/** A view that shows a component pane's data. */
type TProductsView = HTMLElement & { products?: Record<string, unknown> };
/** A view that shows a part of the record it shows. */
type TPartView = HTMLElement & { revealPart?: (part: TPart) => void };

/** A pane of one kind. */
type TPaneOf<K extends DesiredPaneType> = Extract<DesiredPane, { paneType: K }>;
/** What a column entry states of a pane of one kind, without where the pane stands, as the pane schema reads it. */
type TParsed<K extends DesiredPaneType> = Omit<Extract<z.input<typeof DesiredPaneSchema>, { paneType: K }>, "paneType" | "flag" | "docked">;

/** A kind of pane. Method signatures, so a kind's entry reads as an entry for any pane. `seed` gives a new pane's view what
 *  it shows before the view attaches, and `update` gives an open pane's view what a new request for it carries. */
type TPaneKind<K extends DesiredPaneType> = {
	prefix: string;
	address(d: TPaneOf<K>): string;
	entry(d: TPaneOf<K>, id: string): string;
	tag(d: TPaneOf<K>, context: TPaneContext): string;
	label(d: TPaneOf<K>): string;
	column(d: TPaneOf<K>): string;
	parse?(body: string): TParsed<K> | null;
	seed?(d: TPaneOf<K>, view: HTMLElement): void;
	update?(d: TPaneOf<K>, view: HTMLElement): void;
};

/** `left:right` split at its first colon, or null where it doesn't have one. */
const atColon = (s: string): readonly [string, string] | null => {
	const i = s.indexOf(":");
	return i < 0 ? null : [s.slice(0, i), s.slice(i + 1)];
};
/** A type and the one value an entry names after it, as `Type:value`. */
const ofType =
	<F extends string>(field: F) =>
	(body: string) => {
		const split = atColon(body);
		return split ? ({ persistedAs: split[0], [field]: split[1] } as { persistedAs: string } & Record<F, string>) : null;
	};
/** The entry of a pane whose entry is its id. */
const byId = (_d: DesiredPane, id: string): string => id;
/** Gives a component pane's view the data its pane carries. */
const giveData = (d: TPaneOf<"component">, view: HTMLElement): void => {
	if (d.data) (view as TProductsView).products = d.data;
};

/** Each kind of pane. A component's entry is its tag, which doesn't have a prefix, so an entry that a prefix doesn't name is
 *  a component. */
export const PANE_KINDS = {
	component: { prefix: "", address: (d) => d.tag, entry: byId, tag: (d) => d.tag, label: (d) => d.label, column: (d) => d.tag, seed: giveData, update: giveData },
	entity: {
		prefix: "e:",
		address: (d) => objectId(d.persistedAs, d.id),
		// The entry of a record opened at a part names the part.
		entry: (d, id) => (d.selector ? `${id}${PART_DIRECTIVE}${partDirectiveFor(d.selector)}` : id),
		// A type declares the component its records open in, else the entity column shows them.
		tag: (d, context) => {
			const declared = context.recordComponent(d.persistedAs);
			return declared === undefined ? SHU_TAG.ENTITY_COLUMN : declared;
		},
		label: (d) => d.label ?? d.id,
		column: () => "entity",
		parse: (body) => {
			const { base, anchor } = splitPart(body);
			const split = atColon(base);
			return split ? { persistedAs: split[0], id: split[1], ...(anchor ? { selector: anchor } : {}) } : null;
		},
		// An open record's view already shows the record, so a request with a part gives it the part to show.
		update: (d, view) => {
			if (d.selector) (view as TPartView).revealPart?.(d.selector);
		},
	},
	type: {
		prefix: "type:",
		address: (d) => d.persistedAs,
		entry: byId,
		tag: () => SHU_TAG.TYPE_COLUMN,
		label: (d) => d.persistedAs,
		column: () => "type",
		parse: (body) => ({ persistedAs: body }),
	},
	"filter-eq": {
		prefix: "f:",
		address: (d) => `${d.persistedAs}:${d.predicate}=${d.value}`,
		entry: byId,
		tag: () => SHU_TAG.FILTER_COLUMN,
		label: (d) => `${d.predicate}=${d.value}`,
		column: () => "filter",
		parse: (body) => {
			const split = atColon(body);
			const eq = split ? split[1].indexOf("=") : -1;
			return split && eq >= 0 ? { persistedAs: split[0], predicate: split[1].slice(0, eq), value: split[1].slice(eq + 1) } : null;
		},
	},
	"filter-prop": {
		prefix: "p:",
		address: (d) => `${d.persistedAs}:${d.predicate}`,
		entry: byId,
		tag: () => SHU_TAG.FILTER_COLUMN,
		label: (d) => d.predicate,
		column: () => "filter",
		parse: ofType("predicate"),
	},
	"filter-incoming": {
		prefix: "i:",
		address: (d) => `${d.persistedAs}:${d.subject}`,
		entry: byId,
		tag: () => SHU_TAG.FILTER_COLUMN,
		label: (d) => `links to ${d.subject}`,
		column: () => "filter",
		parse: ofType("subject"),
	},
	thread: {
		prefix: "t:",
		address: (d) => `${d.persistedAs}:${d.subject}`,
		entry: byId,
		tag: () => SHU_TAG.THREAD_COLUMN,
		label: (d) => `Replies: ${d.subject}`,
		column: () => "thread",
		parse: ofType("subject"),
	},
	step: {
		prefix: "def:",
		address: (d) => d.method,
		entry: byId,
		tag: () => SHU_TAG.STEP_DEFINITION,
		label: (d) => d.method,
		column: () => "step",
		parse: (method) => ({ method }),
	},
	action: {
		prefix: "act:",
		address: (d) => d.action,
		entry: byId,
		tag: () => SHU_TAG.ACTION_COLUMN,
		label: (d) => d.action,
		column: () => "action",
		parse: (action) => ({ action }),
	},
	"views-picker": { prefix: "", address: () => "views", entry: byId, tag: () => SHU_TAG.VIEWS_PICKER, label: (d) => d.label, column: () => "views-picker" },
} satisfies { [K in DesiredPaneType]: TPaneKind<K> };

/** A kind's entry, read for any pane, as its method signatures allow. */
type TAnyPaneKind = {
	prefix: string;
	address(d: DesiredPane): string;
	entry(d: DesiredPane, id: string): string;
	tag(d: DesiredPane, context: TPaneContext): string;
	label(d: DesiredPane): string;
	column(d: DesiredPane): string;
	parse?(body: string): object | null;
	seed?(d: DesiredPane, view: HTMLElement): void;
	update?(d: DesiredPane, view: HTMLElement): void;
};

/** Returns the entry of a pane's kind. */
const kindOf = (d: DesiredPane): TAnyPaneKind => PANE_KINDS[d.paneType];

/** Returns the id a pane is held and addressed by: its kind's prefix and its address. */
export const paneIdOf = (d: DesiredPane): string => `${kindOf(d).prefix}${kindOf(d).address(d)}`;

/** Returns the column entry that addresses a pane. */
export const columnEntryOf = (d: DesiredPane): string => kindOf(d).entry(d, paneIdOf(d));

/** Returns the component that shows a pane. */
export const tagOf = (d: DesiredPane, context: TPaneContext): string => kindOf(d).tag(d, context);

/** Returns a pane's label. */
export const labelOf = (d: DesiredPane): string => kindOf(d).label(d);

/** Returns the column type that marks a pane. */
export const columnTypeOf = (d: DesiredPane): string => kindOf(d).column(d);

/** Gives a new pane's view what it shows before it attaches. */
export const seedView = (d: DesiredPane, view: HTMLElement): void => kindOf(d).seed?.(d, view);

/** Gives an open pane's view what a new request for it carries. */
export const updateView = (d: DesiredPane, view: HTMLElement): void => kindOf(d).update?.(d, view);

/** Returns the pane a column entry names, or null for an entry that doesn't name one, which a restore skips. The prefix names
 *  the kind, an entry without a kind's prefix is a component's tag, and the entry's endings state where the pane stands. */
export function parseColEntry(raw: string, context: TPaneContext): DesiredPane | null {
	const { id: body, endings } = splitPaneEntry(raw);
	const placement = { flag: endings.has("max") ? ("max" as const) : endings.has("min") ? ("min" as const) : undefined, docked: endings.has("dock") || undefined };
	for (const [paneType, kind] of Object.entries(PANE_KINDS) as [DesiredPaneType, TAnyPaneKind][]) {
		if (!kind.prefix || !kind.parse || !body.startsWith(kind.prefix)) continue;
		const parsed = kind.parse(body.slice(kind.prefix.length));
		return parsed ? parsedPane({ paneType, ...parsed, ...placement }) : null;
	}
	return parsedPane({ paneType: "component", tag: body, label: context.componentTitle(body), ...placement });
}

/** Returns the pane `input` states, or null where the schema refuses it. */
function parsedPane(input: unknown): DesiredPane | null {
	const r = DesiredPaneSchema.safeParse(input);
	return r.success ? r.data : null;
}

/** A pane's key in the `activePane` signal: its columnKey, or its column-type for the query pane, which doesn't have a
 *  columnKey. A pane that lacks both is a fault in the view that renders it. */
export function paneKeyOf(pane: HTMLElement): string {
	const key = pane.dataset.columnKey;
	if (key !== undefined) return key;
	const type = pane.getAttribute(SHU_ATTR.COLUMN_TYPE);
	if (type === null) throw new Error(`a column pane lacks both a columnKey and a ${SHU_ATTR.COLUMN_TYPE}. The column strip sets one where it renders the pane.`);
	return type;
}
