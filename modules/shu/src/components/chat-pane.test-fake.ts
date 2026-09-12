/**
 * The page a pane test drives the Ask pane on.
 *
 * Three test files drive the pane, and each needs the same page around it: a step registry answering without a server,
 * no extension tags, no view to harvest, and a conduit reached the way the pane reaches one. Only the answers differ
 * between cases, so only the answers are written per case, and a change to how the pane reaches the server is one edit
 * rather than three.
 */

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

/** The pane as a case drives it: the element, and what a case calls on it. */
export type TDriven = HTMLElement & {
	updateComplete: Promise<unknown>;
	handleChat(prompt: string): Promise<void>;
	submitChat(): void;
	outputTarget: unknown;
	setState(s: Record<string, unknown>): void;
};
