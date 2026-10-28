/** The Ask pane as a test drives it, which shu's pane tests and a dependent's tests of its ask flow share. */

/** The pane as a case drives it: the element, and what a case calls on it. */
export type TDriven = HTMLElement & {
	updateComplete: Promise<unknown>;
	submitChat(): Promise<void>;
	setState(s: Record<string, unknown>): void;
	fork(forking: { prompt: string; patterns: unknown[]; inReplyTo?: string; send: boolean }): Promise<void>;
};
