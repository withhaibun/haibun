/**
 * A saved scene as the graph holds it: the record a save writes, and the scenes among the records a read returns.
 */
import { SCENE_LABEL } from "@haibun/core/lib/resources.js";

/** The options of every view a scene holds, keyed by element tag. Opaque to the graph; each view validates its own. */
export type TSceneState = Record<string, Record<string, unknown>>;

/** A saved scene as the graph holds it. */
export type TScene = { id: string; state: TSceneState };

/** The type of a saved scene's records. */
export const sceneType = (): string => SCENE_LABEL;

/** The record a save of the scene `name` writes, at `accessLevel` where one is stated, made at `now`. */
export const sceneRecord = (name: string, state: TSceneState, accessLevel: string | undefined, now: string) => ({
	label: SCENE_LABEL,
	data: { id: name, generatedAtTime: now, ...(accessLevel ? { accessLevel } : {}), state: JSON.stringify(state) },
});

/** The saved scenes among a read's records: each record with an id and its options as text. */
export const scenesOf = (vertices: readonly Record<string, unknown>[]): TScene[] =>
	vertices.flatMap((vertex) => (typeof vertex.id === "string" && typeof vertex.state === "string" ? [{ id: vertex.id, state: JSON.parse(vertex.state) as TSceneState }] : []));
