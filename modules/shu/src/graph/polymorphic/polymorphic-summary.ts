/**
 * The order a graph states itself in, for a reader who is not looking at it.
 *
 * A reader asking about a graph is asking about the node they are on and what it connects to. The scene is the only
 * thing that knows which that is, so it states those statements first and the rest in the order it drew them. How many
 * of them travel is the harvest's to say, and how many reach a model is the window's; both keep what arrives first,
 * which is why this decides the order and neither of them has to know what a graph is.
 */
import { RPC_METHOD } from "../../consts.js";
import { reads, type TLink } from "../../hypermedia.js";
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
export const readsEveryStatement = (asks: { perTypeLimit: number; accessLevel: string }): TLink =>
	reads(RPC_METHOD.CLUSTERED_QUADS, asks, "every statement this graph draws");
