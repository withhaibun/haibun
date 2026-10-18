/**
 * The port of a prompt: a prompter a person answers, such as the console or a monitor.
 */
export type TPrompt = { id: string; message: string; context?: unknown; options?: string[] };

export type TPromptResponse = string | object | undefined;

export interface IPrompter {
	prompt(prompt: TPrompt): Promise<TPromptResponse>;
	cancel(id: string, reason?: string): void;
	resolve(id: string, value: TPromptResponse): void;
}
