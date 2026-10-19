/**
 * The engine's terms as text: an atom, a list, and the reason a node's verdict isn't proved, as its line states it.
 */
import type { TVerdict } from "@haibun/core/lib/domains/protocol.js";

/** A Prolog atom that holds the text as it is. */
export const atom = (text: string): string => `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** The text a quoted Prolog atom holds, as `atom` quotes it. */
const atomText = (quoted: string): string => quoted.replace(/\\(['\\])/g, "$1");

/** A Prolog list of terms. */
export const list = (terms: readonly string[]): string => `[${terms.join(", ")}]`;

/** What each reason the engine states means, as a line reads. */
const REASONS: Record<string, string> = {
	empty: "its domain doesn't have members to check",
	cycle: "its waypoint is applied again with the same arguments below itself",
	refused: "its step was refused",
	no_proof: "its waypoint doesn't have a proof, and ensure takes a waypoint with a proof",
	not_waypoint: "ensure takes a waypoint, and its statement isn't one",
	none: "its parts don't prove it",
};

/** The reason a node's verdict isn't proved, where the engine states a reason in place of a part. */
export function whyText(line: string, verdict: TVerdict, reason: string): string {
	const depth = reason.match(/^depth\((\d+)\)$/);
	if (depth !== null) return `${line} is ${verdict}: its proof reached the engine's bound of ${depth[1]}`;
	const refused = reason.match(/^refused\('?(.*?)'?\)$/s);
	if (refused !== null) return `${line} is ${verdict}: ${atomText(String(refused[1]))}`;
	const known = REASONS[reason];
	if (known === undefined) throw new Error(`the engine stated the reason ${reason} for "${line}", which the engine's program doesn't declare`);
	return `${line} is ${verdict}: ${known}`;
}
