/**
 * Actuality's concern catalog as a view and a read look it up (`page/derivations/catalog.ts`), from the catalog of the step
 * registry the page holds. Each reader throws before the page reads actuality's steps, and names what it read. The dropdown
 * values each type offers are held in the root, across the page's bundles.
 */
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import type { TConcernCatalog, TTitledBy } from "@haibun/core/lib/hypermedia.js";
import { pageRegistry, selectValues } from "../root.js";
import { REGISTRY_STATUS } from "../machines/registry.js";
import * as Catalog from "../derivations/catalog.js";
import { heldCatalog, holdsCatalog } from "../pipelines/held-catalog.js";

/** Returns the catalog the page holds. Throws before the page reads actuality's steps, and names what `what` read. */
const catalog = (what: string): Catalog.TCatalog => heldCatalog(pageRegistry(), what);

/** Whether the page holds a catalog, which a page that carries a record without the site's registry doesn't. */
export const hasCatalog = (): boolean => holdsCatalog(pageRegistry());

/** Returns the first type the catalog declares, which a view that isn't given a type reads. Throws where the catalog
 *  doesn't declare a type. */
export function firstDeclaredType(): string {
	const [first] = getTypes();
	if (first === undefined) throw new Error("the catalog doesn't declare a type, so a view that isn't given one doesn't read one");
	return first;
}

/** Returns the label and declaration of each UI extension the concerns mount in one of `slots` from a script. */
export const slotExtensions = (slots: ReadonlyArray<string>): Array<[string, Record<string, unknown>]> =>
	Object.entries(catalog("the slot extensions").ui).filter(([, ui]) => slots.includes(String(ui.slot)) && ui.js !== undefined);

/** Returns the concern catalog the page holds. */
export function getConcernCatalog(): TConcernCatalog {
	const state = pageRegistry().state.get();
	if (state.status !== REGISTRY_STATUS.READ) throw new Error("the concern catalog is read after actuality's steps: call getAvailableSteps() first");
	return state.read.list.concerns;
}

/** Returns a type's fields by relation, or undefined where the catalog doesn't declare the type. */
export const getRels = (label: string): Record<string, string> | undefined => catalog(`the fields of ${label}`).rels[label];

/** Whether records persist under `name`, which a `#Type` link names. */
export const isKnownType = (name: string): boolean => getRels(name) !== undefined;

/** Returns every type the catalog declares. */
export const getTypes = (): string[] => catalog("the types").types;

/** Returns the relation a field of `label` declares, a property or an edge, or undefined where it doesn't declare the field. */
export const getFieldRel = (label: string, field: string): string | undefined => catalog(`the relation of ${label}.${field}`).fieldRels[label]?.[field];

/** Returns the range of the relation a field of `label` declares (HM17). */
export const rangeOf = (label: string, field: string): Catalog.TPropertyDefinition["range"] | undefined => Catalog.rangeOf(catalog(`the range of ${label}.${field}`), label, field);

/** Whether a type is one of haibun's own. */
export const isSystemSchemaType = (label: string): boolean => Catalog.isSystemSchemaType(catalog(`whether ${label} is haibun's`), label);

/** Returns the property or edge that titles a type, where it declares one. */
export const getTitledBy = (label: string): TTitledBy | undefined => catalog(`the title of ${label}`).titledBy[label];

/** Whether a type records actuality's own execution. */
export const isInstrumentationType = (label: string): boolean => catalog(`whether ${label} records execution`).instrumentationTypes.has(label);

/** Returns what the ontology declares of a relation, or undefined for a relation it doesn't declare. */
export const getPropertyDefinition = (rel: string): Catalog.TPropertyDefinition | undefined => catalog(`the definition of ${rel}`).propertyDefinitions[rel];

/** Returns a type's edges and the types each may point at, or undefined where it doesn't declare an edge. */
export const getEdgeRanges = (label: string): Record<string, string[]> | undefined => catalog(`the edges of ${label}`).edgeRanges[label];

/** Returns the types an edge may point at from `sourceLabel`, else from any type that declares it. */
export const getEdgeTargetLabels = (edgeType: string, sourceLabel?: string): string[] | undefined =>
	Catalog.edgeTargetLabels(catalog(`the targets of ${edgeType}`), edgeType, sourceLabel);

/** Returns the type of the record a field of `label` names, where the field is an edge to one type. */
export const edgeRecordType = (label: string, field: string): string | undefined => Catalog.edgeRecordType(catalog(`the record type of ${label}.${field}`), label, field);

/** Returns a type's id field, or undefined where the catalog doesn't declare the type. */
export const getIdField = (label: string): string | undefined => catalog(`the id field of ${label}`).idFields[label];

/** Returns the fields a type accepts as query filters, or an empty list where it doesn't declare one. */
export function getQueryableFields(label: string): string[] {
	const queryable = catalog(`the queryable fields of ${label}`).queryable[label];
	return queryable === undefined ? [] : queryable;
}

/** Returns the field that carries a type's valid time. Throws for a type the catalog doesn't declare. */
export function getValidTimeField(label: string): string {
	const field = catalog(`the valid time of ${label}`).validTimeFields[label];
	if (field === undefined) throw new Error(`the catalog doesn't declare the type ${label}, so it doesn't name the field of its valid time`);
	return field;
}

/** Returns the summary fields of a type: its name and context fields. */
export function getSummaryFields(label: string): Set<string> {
	const summary = catalog(`the summary of ${label}`).summary[label];
	return new Set(summary === undefined ? [] : summary);
}

/** Returns a type's fields in the order a view shows them. */
export const getPropertyOrder = (label: string): string[] => Catalog.propertyOrder(catalog(`the field order of ${label}`), label);

/** Returns the UI extension a type's domain declares, where it declares one. */
export const getUiByType = (label: string): Record<string, unknown> | undefined => catalog(`the UI of ${label}`).ui[label];

/** Returns the views the catalog declares. */
export const declaredViews = (): string[] => Catalog.declaredViews(catalog("the declared views"));

/** Returns the element that shows a view. */
export const componentOfView = (view: string): string => Catalog.componentOfView(catalog(`the component of ${view}`), view);

/** Returns the component a record of `label` opens as, or undefined for the generic view. */
export const getRecordComponent = (label: string): string | undefined => Catalog.recordComponent(catalog(`the record component of ${label}`), label);

/** Returns the declaration of the component `component` names. */
export const getUiByComponent = (component: string): Record<string, unknown> | undefined => Catalog.uiOfComponent(catalog(`the UI of ${component}`), component);

/** Returns the concern that presents `kind`. */
export const getUiPresenting = (kind: string): { type: string; ui: Record<string, unknown> } | undefined => Catalog.uiPresenting(catalog(`the presenter of ${kind}`), kind);

/** Returns the tags of the elements the concerns mount in `slot`. */
export const getUiExtensionTags = (slot: string): string[] => Catalog.uiExtensionTags(catalog(`the extensions of ${slot}`), slot);

/** Returns the tags of the elements in the actions bar's input line, in every mode. The bar draws before the page reads
 *  actuality's steps, without an extension, and draws again once its read returns. */
export const getActionBarChatExtensionTags = (): string[] => (hasCatalog() ? getUiExtensionTags(Catalog.ACTION_BAR_SLOTS.chat) : []);

/** Returns the tags of the elements in the ask's own row, without an extension before the page reads actuality's steps. */
export const getActionBarAskExtensionTags = (): string[] => (hasCatalog() ? getUiExtensionTags(Catalog.ACTION_BAR_SLOTS.ask) : []);

/** Returns each edge's relation, by the edge's name. */
export const getEdgeRelMap = (): Record<string, string> => catalog("the edges' relations").edgeRels;

/** Returns a type's description, or undefined for a view that isn't a registered type. */
export const getTypeDescription = (label: string): string | undefined => getConcernCatalog().persisted[label]?.description;

/** Returns the role edges, highest declared priority first. */
export const roleEdgeLabels = (): readonly string[] => catalog("the role edges").roleEdgeLabels;

/** Returns the role edges as a set. */
export const roleEdgeLabelSet = (): ReadonlySet<string> => catalog("the role edges").roleEdgeLabelSet;

/** Returns the edges a sequence reads as an entity's source lifeline. */
export const fromActorEdgeLabels = (): ReadonlySet<string> => catalog("the source actor edges").fromActorEdgeLabels;

/** Returns the edges a sequence reads as a message's target lifeline. */
export const toActorEdgeLabels = (): ReadonlySet<string> => catalog("the target actor edges").toActorEdgeLabels;

/** Returns the noun a party displays under, given the edge by which others attribute to it, where the catalog declares one. */
export const roleNounFor = (edgeLabel: unknown): string | undefined => (typeof edgeLabel === "string" ? catalog("the role nouns").roleNouns.get(edgeLabel) : undefined);

/** Returns the target types of the actor edges of `sourceTypes`. */
export const actorTypesFor = (sourceTypes: Iterable<string>): string[] => Catalog.actorTypesFor(catalog("the actor types"), sourceTypes);

/** Returns the display phrase a concern declares for an edge, where it declares one. */
export const getDeclaredEdgeLabel = (edgeName: string): string | undefined => catalog("the edges' phrases").declaredEdgeLabels.get(edgeName);

/** Returns the fields a type offers as dropdowns. */
export const getSelectFields = (label: string): string[] => Catalog.selectFields(catalog(`the dropdowns of ${label}`), label);

/** Holds the dropdown values a type's fields offer, as the site returned them. */
export const setSelectValues = (label: string, values: Record<string, string[]>): void => selectValues.set({ ...selectValues.get(), [label]: values });

/** Whether the page holds the dropdown values of a type. */
export const hasSelectValues = (label: string): boolean => selectValues.get()[label] !== undefined;

/** Returns the dropdown values the page holds for a type. Throws where it doesn't hold them. */
export function getSelectValues(label: string): Record<string, string[]> {
	const values = selectValues.get()[label];
	if (values === undefined) throw new Error(`the page reads the dropdown values of ${label} before it holds them: read them with selectValuesFor first`);
	return values;
}

/** Whether a type's dropdown values hold an option, where an empty list was read before the data existed. */
export const hasUsableSelectValues = (label: string): boolean => hasSelectValues(label) && Object.values(getSelectValues(label)).some((v) => v.length > 0);

/** Adds to a type's dropdowns the values its live quads carry, for each field the type offers. Returns whether it added one,
 *  so a caller draws again only where the dropdowns changed. A value that appears is in the quad that carries it, so a view
 *  reads it from the batch, without a read that records itself in the graph and changes it again. */
export function addObservedSelectValues(label: string, quads: readonly TQuad[]): boolean {
	const held = selectValues.get()[label];
	if (held === undefined) return false;
	const next: Record<string, string[]> = { ...held };
	let added = false;
	for (const quad of quads) {
		const values = next[quad.predicate];
		if (quad.namedGraph !== label || values === undefined || typeof quad.object !== "string" || quad.object === "" || values.includes(quad.object)) continue;
		next[quad.predicate] = [...values, quad.object].sort();
		added = true;
	}
	if (added) setSelectValues(label, next);
	return added;
}
