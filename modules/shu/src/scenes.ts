/**
 * Scenes: saving a way of looking at the graph, and returning to it.
 *
 * A scene is a named record of the durable options of one or more views, keyed by element tag. Capture and apply are
 * the ShuElement primitives (`captureSceneState` / `applySceneState`), so a scene holds exactly what a view already
 * remembers across a reload; this module carries scenes to and from the graph through the ordinary step RPC, the same
 * gate every other write goes through.
 */
import { AccessLevelSchema, SCENE_LABEL } from "@haibun/core/lib/resources.js";
import { hasCatalog, fromActorEdgeLabels, getEdgeRanges, getPropertyDefinition, getRels, getTypes, toActorEdgeLabels } from "./page/controllers/catalog-controller.js";
import type { TCallOutcome } from "./page/pipelines/call-step.js";
import { SHU_TAG } from "./domains/elements.js";
import type { ShuElement } from "./page/components/shu-element.js";
import { appAccessLevel } from "./view-query.js";
import { listRecords } from "./page/controllers/read-controller.js";
import { callStep } from "./page/controllers/read-controller.js";

/** The options of every view a scene holds, keyed by element tag. Opaque to the graph; each view validates its own. */
export type TSceneState = Record<string, Record<string, unknown>>;

/** A saved scene as the graph holds it. */
export type TScene = { id: string; state: TSceneState };

/** Read the durable options of the given views, keyed by tag: what a scene saves. */
export function captureScene(views: Array<ShuElement<never> | (Element & { captureSceneState(): Record<string, unknown> })>): TSceneState {
	const state: TSceneState = {};
	for (const view of views) state[view.tagName.toLowerCase()] = view.captureSceneState();
	return state;
}

/** Set each view's options from a scene. A view the scene does not name keeps what it has; a view the scene names but the page lacks is an error, not a silent partial restore. */
export function applyScene(views: Array<Element & { applySceneState(fields: Record<string, unknown>): void }>, state: TSceneState): void {
	const byTag = new Map(views.map((view) => [view.tagName.toLowerCase(), view]));
	for (const [tag, fields] of Object.entries(state)) {
		const view = byTag.get(tag);
		if (!view) throw new Error(`scene names the view <${tag}>, which is not on this page`);
		view.applySceneState(fields);
	}
}

/**
 * The level to store a new record at, given what the reader is looking at. `all` relaxes the READ ceiling and is not a
 * level anything can be stored at, so it maps to undefined: saving under it wrote a record the schemas don't accept,
 * and the page didn't show the failure, so saving didn't appear to act.
 */
export function storedAccessLevel(viewing: string): string | undefined {
	return AccessLevelSchema.safeParse(viewing).success ? viewing : undefined;
}

/** The step that creates a record of a type it names, which the store's stepper offers for every declared type. */
const CREATE_A_RECORD = "createTyped";

/** Save a scene under `name`, replacing one of that name. Writes through the step RPC, as every write does. */
export function saveScene(name: string, state: TSceneState, why: string): Promise<TCallOutcome<unknown>> {
	const accessLevel = storedAccessLevel(appAccessLevel());
	return callStep(
		CREATE_A_RECORD,
		{ label: SCENE_LABEL, data: { id: name, generatedAtTime: new Date().toISOString(), ...(accessLevel ? { accessLevel } : {}), state: JSON.stringify(state) } },
		why,
	);
}

/** The scene every deployment has: what it exchanged with what, and under what authority. */
export const NETWORK_SCENE = "network";

/** The vocabulary that marks a type as part of an exchange: who acted, and what they were allowed. `sec:` is the
 *  capability and key vocabulary; `prov:wasAssociatedWith` is the actor of an activity, which is what a request and a
 *  step each name. A type is in by what it declares, so one added later for this purpose is in without an edit here. */
const EXCHANGE_IRIS = (iri: string): boolean => iri.startsWith("sec:") || iri === "prov:wasAssociatedWith";

/**
 * The types the network scene shows, derived from the site's own declarations.
 *
 * The seed is every type declaring a rel of the exchange vocabulary: a request naming who performed it, a step naming
 * what it required and what allowed it, a principal naming its keys, a capability naming its controller. Then one hop
 * along those types' ACTOR edges only, who a thing came from and what it was directed at, the same edges the sequence
 * view reads as lifelines, so where a request went and who held a capability come with it, while what a record merely
 * carries (its bodies, its selectors) does not. This module doesn't name a type: a deployment's own vocabulary decides.
 */
export function networkSceneTypes(): string[] {
	if (!hasCatalog()) return []; // a view that draws before the page reads actuality's steps derives no network scene
	const declares = (label: string): boolean =>
		Object.values(getRels(label) ?? {}).some((rel) => {
			const iri = getPropertyDefinition(rel)?.iri;
			return !!iri && EXCHANGE_IRIS(iri);
		});
	const actorEdges = new Set([...fromActorEdgeLabels(), ...toActorEdgeLabels()]);
	const seed = getTypes().filter(declares);
	const reached = seed.flatMap((label) =>
		Object.entries(getEdgeRanges(label) ?? {})
			.filter(([edge]) => actorEdges.has(edge))
			.flatMap(([, ranges]) => ranges),
	);
	return [...new Set([...seed, ...reached])].filter((label) => getTypes().includes(label)).sort();
}

/** The scenes a deployment always has, whatever anyone saved. Their state is derived, so it is right for this site. */
export function builtInScenes(): TScene[] {
	const types = networkSceneTypes();
	if (types.length === 0) return [];
	// Every type is named, the exchange shown and the rest hidden. Naming only what to show leaves whatever is visible
	// by default visible beside it, and the scene reads as the whole graph with the exchange added to it.
	const shown = new Set(types);
	const overrides = Object.fromEntries(getTypes().map((type) => [type, shown.has(type)]));
	return [{ id: NETWORK_SCENE, state: { [SHU_TAG.POLYMORPHIC_GRAPH_VIEW]: { viewType: "sequence" }, "shu-graph-filter": { overrides } } }];
}

/** The scenes saved here, newest first, for a reader to pick from. */
export async function listScenes(why: string): Promise<TScene[]> {
	const saved = await savedScenes(why);
	// A saved scene of the same name is the reader's own adjustment of it, so it wins; otherwise the built-in is there
	// whether or not anything was ever saved.
	const named = new Set(saved.map((scene) => scene.id));
	return [...saved, ...builtInScenes().filter((scene) => !named.has(scene.id))];
}

async function savedScenes(why: string): Promise<TScene[]> {
	const result = await listRecords(SCENE_LABEL, why);
	if (!result.ok) return [];
	return result.value.vertices.flatMap((vertex) => {
		if (typeof vertex.id !== "string" || typeof vertex.state !== "string") return [];
		return [{ id: vertex.id, state: JSON.parse(vertex.state) as TSceneState }];
	});
}

/** One saved scene by name, or undefined when a scene isn't saved under it. */
export async function readScene(name: string, why: string): Promise<TScene | undefined> {
	return (await listScenes(why)).find((scene) => scene.id === name);
}
