/**
 * A session as a selector offers it: what its first question asked, when its newest turn was sent, and how many turns it
 * gained since this page last read it.
 */
import type { TSessionList } from "@haibun/core/lib/conversation/domains/conversation.js";
import { formatInstant, type TReaderZone } from "../../derivations/time-format.js";

/** A session the store lists. */
export type TListedSession = TSessionList["sessions"][number];

/** How many characters of a session's first question its label shows. */
const PREVIEW_CHARS = 48;

/** Returns a session's label: its first question, cut to the preview's length, the time of its newest turn in `zone`
 *  against `now`, and the turns it gained. */
export function sessionLabel(session: TListedSession, gained: number, now: Date, zone: TReaderZone): string {
	const preview = session.label.length > PREVIEW_CHARS ? `${session.label.slice(0, PREVIEW_CHARS - 1)}…` : session.label;
	const when = formatInstant(session.generatedAtTime, now, zone);
	return `${preview} · ${when}${gained > 0 ? ` · ${gained} new` : ""}`;
}
