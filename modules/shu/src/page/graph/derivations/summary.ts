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
import type { TQuad } from "@haibun/core/lib/quad-types.js";

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
