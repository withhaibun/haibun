/**
 * The page a pane test drives the Ask pane on.
 *
 * Two test files drive the pane, and each needs the same page around it: a step registry answering without a server,
 * no extension tags, no view to harvest, and a conduit reached the way the pane and the conversation reach one. Only the
 * answers differ between cases, so only the answers are written per case, and a change to how the page reaches the
 * server is one edit rather than two.
 */

import type { TSessionTurn } from "../schemas.js";

export type TReq = { method: string; params?: Record<string, unknown> };
/** What a read is answered with, which a case may answer with a promise of its own to hold the read open. */
export type TFollow = (req: TReq) => unknown;
export type TStream = (req: TReq, onChunk: (chunk: unknown) => void, opts: { onStart?: (seqPath: number[]) => void; signal?: AbortSignal }) => Promise<void>;

/** The step registry as a page with no server holds it: every step is named by itself. */
export const rpcRegistry = { getAvailableSteps: () => Promise.resolve(), findStep: (n: string) => n, requireStep: (n: string) => n };

/** The hypermedia module, answering each read and each stream the way the case states. */
export const hypermedia = (follow: TFollow, followStream: TStream) => ({
	reads: (method: string, params?: Record<string, unknown>) => ({ method, params, asks: "read" }),
	acts: (method: string, params?: Record<string, unknown>) => ({ method, params, asks: "act" }),
	isOffline: () => false,
	isServerUnreachable: () => false,
	conduit: () => ({ follow: (req: TReq) => Promise.resolve(follow(req)), followStream }),
});

/** A turn of a session as the store reads it back, its question, answer and comments named by its seqPath. */
export const readBack = (seqPath: string, inReplyTo?: string, bundle: TSessionTurn["bundle"] = []): TSessionTurn => ({
	prompt: `asked ${seqPath}`,
	response: `answered ${seqPath}`,
	seqPath,
	...(inReplyTo ? { inReplyTo } : {}),
	askId: `cmt-ask-${seqPath}`,
	sayId: `cmt-say-${seqPath}`,
	bundle,
});

/** The pane as a case drives it: the element, and what a case calls on it. */
export type TDriven = HTMLElement & {
	updateComplete: Promise<unknown>;
	ask(prompt: string): Promise<void>;
	submitChat(): void;
	setState(s: Record<string, unknown>): void;
};
