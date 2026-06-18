/**
 * The ONE cross-system handle for a graph object, derived from its (type, id). Every layer that needs to ADDRESS an
 * object — the column pane id, a DOM `data-testid`, a 3D-view node lookup, a test — derives the handle here, so the
 * shape is identical everywhere and changing it is a one-line refactor. The store vertex id stays the object's
 * natural id (e.g. an Email's messageId); this composes type+id into a single collision-free, test-addressable handle.
 */
export function objectId(type: string, id: string): string {
	return `${type}:${id}`;
}
