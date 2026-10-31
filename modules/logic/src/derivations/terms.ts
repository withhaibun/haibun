/**
 * The engine's terms as text: an atom, a list, and the reason a node's verdict isn't proved, as its line states it.
 */
import type { TVerdict } from "@haibun/core/lib/domains/protocol.js";
import { DIFFERENT_BUILDS } from "../domains/logic.js";

/** A Prolog atom that holds the text as it is. */
export const atom = (text: string): string => `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** The text a quoted Prolog atom holds, as `atom` quotes it. */
const atomText = (quoted: string): string => quoted.replace(/\\(['\\])/g, "$1");

/** A Prolog list of terms. */
export const list = (terms: readonly string[]): string => `[${terms.join(", ")}]`;

/** What each reason the engine states means, as a line reads. */
const REASONS: Record<string, string> = {
	empty: "its domain doesn't hold a value to check",
	cycle: "its waypoint applies itself again with the same values",
	refused: "its step was refused",
	no_proof: "its waypoint doesn't have a proof",
	not_waypoint: "its statement isn't a waypoint's head. State a waypoint's head to ensure it",
	none: "its parts don't prove it",
};

/** The reason a node's verdict isn't proved, where the engine states a reason in place of a part. */
export function whyText(line: string, verdict: TVerdict, reason: string): string {
	const depth = reason.match(/^depth\((\d+)\)$/);
	if (depth !== null) return `\`${line}\` is ${verdict}: its proof went past ${depth[1]} steps, the bound of a proof`;
	const nesting = reason.match(/^nesting\((\d+)\)$/);
	if (nesting !== null)
		return `\`${line}\` is ${verdict}: its proof nests the proofs of waypoints past ${nesting[1]} sessions, the bound of nesting, since a step in a waypoint's proof applies a waypoint whose proof does so again. State the waypoints its proof reaches as lines of the proof, which the reasoner proves in one session`;
	const refused = reason.match(/^refused\('?(.*?)'?\)$/s);
	if (refused !== null) return `\`${line}\` is ${verdict}: ${atomText(String(refused[1]))}`;
	const known = REASONS[reason];
	if (known === undefined) throw new Error(`The proof of \`${line}\` states a reason the TypeScript prover doesn't read. ${DIFFERENT_BUILDS}`);
	return `\`${line}\` is ${verdict}: ${known}`;
}
