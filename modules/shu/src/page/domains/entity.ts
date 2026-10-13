/**
 * One record as the page shows it: the record with its edges, the notes anchored in it, the bodies the reader opened, and
 * how the page read it.
 */
import type { TAnnotationView } from "@haibun/core/lib/resources.js";
import type { TIndividualWithEdges } from "@haibun/core/lib/quad-types.js";
import type { TPageRefusal } from "./refusal.js";
import { LOAD_STATUS, type TLoadStatus } from "./load.js";

/** A record with its edges and the count of the edges that reach it, as the site's read returns it. */
export type TEntityResult = TIndividualWithEdges;

/** The source of a record the page shows: `live` is a read on a served page, `cache` is the copy the page already holds,
 *  and `offline` is a read of the store of a page that carries a record of actuality. */
export type TProvenance = "live" | "cache" | "offline";

/** The page's view of one record. Each read of the record, its notes and its bodies, and each observed change, writes this
 *  one shape, so a view renders the record and its notes from one source. Its status is the read's, in the load machine's
 *  states. */
export type TEntityView = {
	status: TLoadStatus;
	provenance?: TProvenance;
	entity?: TEntityResult;
	annotations: TAnnotationView[];
	/** Why the record wasn't read, where the read was refused. */
	refusal?: TPageRefusal;
	/** The text of each body read, by the body's id. A record names its bodies by id and media type, and a body's text is
	 *  read when a reader opens it. A body id absent here is unread, so its area renders as loading. */
	bodies: Record<string, string>;
};

/** A note draft: the passage the reader selected, and the note's text. */
export type TAnnotationDraft = { exact: string; prefix?: string; suffix?: string; text: string };

/** Returns a new view of a record the page hasn't read: pending before its read starts, or running while it reads. Each call
 *  returns a new view, so one view can't change another view's copy. */
export const unreadView = (status: typeof LOAD_STATUS.PENDING | typeof LOAD_STATUS.RUNNING): TEntityView => ({ status, annotations: [], bodies: {} });

/** Returns whether a view's record is still to read: its read is pending or running. */
export const unread = (view: TEntityView): boolean => view.status === LOAD_STATUS.PENDING || view.status === LOAD_STATUS.RUNNING;
