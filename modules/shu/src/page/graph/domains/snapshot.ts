/**
 * The graph snapshot's vocabulary: the per-type sample's limits, the snapshot a scope holds, and the view context that
 * travels beside it.
 */
import type { TClusteredQuads } from "@haibun/core/lib/quad-types.js";

/** The per-type sample a snapshot reads where a view hasn't chosen one. */
export const DEFAULT_PER_TYPE_LIMIT = 100;
/** Ceiling for the per-type sample, everywhere the limit can be set (the filter slider AND the +N-more cluster expand), so a path can't silently inflate the limit past what the slider expresses. */
export const MAX_PER_TYPE_LIMIT = 1000;

/** The client-held graph snapshot is the wire shape (quads, clusters and the responding site), so the shapes don't drift. */
export type TGraphSnapshot = TClusteredQuads;

/** Which column has keyboard and actions focus, shared by every view so a view lays itself out for off-screen sync. */
export type TViewContext = { activeViewId: string | null };

/** Fired after a scope's snapshot or the shared view context changes. */
export type TSnapshotListener = (snapshot: TGraphSnapshot | null, context: TViewContext) => void;

/** What a snapshot was read under: the per-type limit, the types, and the visibility ceiling. A change of any reads it again. */
export type TSnapshotKey = { perTypeLimit: number; types: string; accessLevel: string };
