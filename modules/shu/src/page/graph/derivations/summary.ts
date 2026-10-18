/**
 * The order a graph states itself in, for a reader who is not looking at it.
 *
 * A reader's question about a graph concerns the node they are on and the nodes it connects. The scene holds that node,
 * so it states those statements first and the rest in the order it drew them. The harvest sets how many of them travel,
 * and the window sets how many reach a model; both keep what arrives first, so this sets the order and the harvest and
 * the window don't depend on what a graph is.
 */
import { RPC_METHOD } from "../../../domains/elements.js";
import { reads, type TLink } from "../../domains/links.js";
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";

type TStated = Pick<TQuad, "subject" | "object">;

/** The statements about `on` first, then the rest in the order they were drawn. */
export function statedAboutFirst<T extends TStated>(stated: readonly T[], on: string | null): T[] {
	if (on === null) return [...stated];
	const about: T[] = [];
	const rest: T[] = [];
	for (const one of stated) (one.subject === on || one.object === on ? about : rest).push(one);
	return [...about, ...rest];
}

/** The call that reads every statement a graph draws, as the view read them: a reader carrying part of a graph asks for
 *  the rest rather than answering from a part it cannot tell is partial. */
export const readsEveryStatement = (asks: { perTypeLimit: number; accessLevel: string }): TLink => reads(RPC_METHOD.CLUSTERED_QUADS, asks, "every statement this graph draws");

/** The display label of the latest step the visible quads hold, by its timestamp, or null where the step type isn't shown
 *  or its sample is empty. A cluster labels each subject it samples. */
export function latestStepLabel(clusters: readonly TCluster[], visibleQuads: readonly TQuad[]): string | null {
	const steps = clusters.find((c) => c.type === SEQ_PATH_LABEL);
	if (steps === undefined || steps.sampledSubjects.length === 0) return null;
	const sampled = new Set(steps.sampledSubjects);
	let latest: { subject: string; timestamp: number } | undefined;
	for (const q of visibleQuads) if (sampled.has(q.subject) && (latest === undefined || q.timestamp > latest.timestamp)) latest = { subject: q.subject, timestamp: q.timestamp };
	if (latest === undefined) return null;
	const label = steps.displayLabels[latest.subject];
	if (label === undefined) throw new Error(`the ${SEQ_PATH_LABEL} cluster lacks a label for the subject ${latest.subject} it samples`);
	return label;
}
